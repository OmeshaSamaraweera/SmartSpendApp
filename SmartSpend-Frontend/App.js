import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Alert } from 'react-native';
import 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import Constants from 'expo-constants';
// initialize i18n once for the whole app (resolves ./i18n/index.js)
import './i18n';
import HomeScreen from './screens/HomeScreen';
import TransactionsScreen from './screens/TransactionScreen';
import RegisterScreen from './screens/RegisterScreen';
import ChatbotScreen from './screens/ChatbotScreen';
import LanguageSettingsScreen from './screens/LanguageSettingsScreen';
import { supabase } from './services/supabase';


const Stack = createStackNavigator();

export default function App() {
  const [session, setSession] = useState(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    
    // Debug logging
    console.log('App starting...');
    console.log('API URL:', Constants.expoConfig?.extra?.apiUrl);
    console.log('Environment:', __DEV__ ? 'Development' : 'Production');

    const init = async () => {
      try {
        console.log('Initializing Supabase connection...');
        
        // Test API connection first
        const apiUrl = Constants.expoConfig.extra.apiUrl;
        console.log('Testing API connection to:', apiUrl);
        
        try {
          const apiResponse = await fetch(`${apiUrl}/health`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          console.log('API Health Check Status:', apiResponse.status);
        } catch (apiError) {
          console.warn('API Health check failed:', apiError.message);
          // Don't fail the app if API health check fails
        }

        // Get Supabase session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Supabase session error:', sessionError.message);
          setError(`Supabase Error: ${sessionError.message}`);
        } else {
          console.log('Supabase session retrieved successfully');
          console.log('Session exists:', !!session);
        }

        if (mounted) {
          setSession(session);
          setBootLoading(false);
        }
      } catch (error) {
        console.error('App initialization error:', error);
        if (mounted) {
          setError(`Initialization Error: ${error.message}`);
          setBootLoading(false);
        }
      }
    };

    init();

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log('Auth state changed:', _event);
      setSession(session);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  // Show error screen if there's a critical error
  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text style={{ color: 'red', fontSize: 16, textAlign: 'center', marginBottom: 20 }}>
          {error}
        </Text>
        <Text style={{ fontSize: 14, textAlign: 'center', color: '#666' }}>
          Check your internet connection and try again.
        </Text>
      </View>
    );
  }

  // Show loading screen while initializing
  if (bootLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#00B8A9" />
        <Text style={{ marginTop: 10, fontSize: 16 }}>Loading...</Text>
        <Text style={{ marginTop: 5, fontSize: 12, color: '#666' }}>
          Connecting to services...
        </Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {session ? (
          <>
            <Stack.Screen name="HomeScreen" component={HomeScreen} />
            <Stack.Screen name="TransactionScreen" component={TransactionsScreen} />
            <Stack.Screen name="Chatbot" component={ChatbotScreen} />
            <Stack.Screen
              name="LanguageSettings"
              component={LanguageSettingsScreen}
              options={{ headerShown: false, presentation: 'card' }}
            />
          </>
        ) : (
          <Stack.Screen name="RegisterScreen" component={RegisterScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
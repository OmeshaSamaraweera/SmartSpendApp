// screens/Charts.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  Modal,
  ScrollView,
  Image,
  Alert,
  Dimensions,
} from 'react-native';
import { VictoryPie } from 'victory-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import {
  Home,
  Wallet,
  DollarSign,
  MoreHorizontal,
  X,
  Bell,
  Palette,
  Globe,
  LogOut,
  Lock,
} from 'lucide-react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const formatCurrency = (v = 0) => `Rs. ${Number(v).toFixed(2)}`;

/* ------------------------- colors & utilities ------------------------- */
const FALLBACK_PALETTE = [
  '#F87171', '#FB923C', '#FBBF24', '#4ADE80', '#34D399', '#60A5FA',
  '#A78BFA', '#F472B6', '#22D3EE', '#FACC15', '#2DD4BF', '#FB7185',
];

const NAMED_TO_HEX = {
  red: '#EF4444',
  orange: '#F97316',
  amber: '#F59E0B',
  yellow: '#F59E0B',
  green: '#22C55E',
  teal: '#14B8A6',
  emerald: '#10B981',
  cyan: '#06B6D4',
  blue: '#3B82F6',
  indigo: '#6366F1',
  violet: '#8B5CF6',
  purple: '#A855F7',
  fuchsia: '#D946EF',
  pink: '#EC4899',
  rose: '#F43F5E',
  gray: '#9CA3AF',
  grey: '#9CA3AF',
  black: '#111827',
  white: '#FFFFFF',
};

const isHex = (v) => typeof v === 'string' && /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(v.trim());
const isRgb = (v) => typeof v === 'string' && /^rgba?\(.+\)$/i.test(v.trim());

function normalizeColor(input, idx) {
  if (!input) return FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
  const c = String(input).trim();
  if (isHex(c) || isRgb(c)) return c;
  // tailwind-like tokens (e.g., "teal-500") or names ("teal")
  const base = c.toLowerCase().split('-')[0];
  if (NAMED_TO_HEX[base]) return NAMED_TO_HEX[base];
  return FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
}

function hexToRgba(hex, alpha = 1) {
  try {
    if (!isHex(hex)) return `rgba(0,0,0,${alpha})`;
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    const int = parseInt(h, 16);
    const r = (int >> 16) & 255, g = (int >> 8) & 255, b = int & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  } catch {
    return `rgba(0,0,0,${alpha})`;
  }
}

/* ------------------------------- More Menu ------------------------------- */
const MoreMenu = ({ isOpen, onClose, onLogout }) => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);

  const goToLanguage = () => {
    onClose?.();
    setTimeout(() => navigation.navigate('LanguageSettings'), 0);
  };

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        setLoading(true);
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) { setName(''); setEmail(''); return; }
        setEmail(user.email ?? '');
        const metaName =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.user_metadata?.username || '';
        if (metaName) { setName(metaName); return; }

        const { data: profileById } = await supabase
          .from('users').select('name,email').eq('id', user.id).maybeSingle();
        if (profileById?.name) { setName(profileById.name); return; }

        const { data: profileByEmail } = await supabase
          .from('users').select('name').eq('email', user.email).maybeSingle();
        setName(profileByEmail?.name || '');
      } finally { setLoading(false); }
    })();
  }, [isOpen]);

  return (
    <Modal visible={isOpen} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.moreModalOverlay}>
        <TouchableOpacity style={styles.moreBackdrop} onPress={onClose} activeOpacity={1} />
        <View style={styles.moreMenu}>
          <ScrollView style={styles.moreMenuContent}>
            <View style={styles.moreMenuHeader}>
              <View style={styles.profileSection}>
                <View style={styles.profileImage}>
                  <Image source={require('./images/App_Logo.png')} style={styles.profileImageContent} />
                </View>
                {loading ? (
                  <ActivityIndicator size="small" color="#6B7280" />
                ) : (
                  <View style={styles.profileInfo}>
                    <Text style={styles.profileName}>{name || '—'}</Text>
                    <Text style={styles.profileEmail}>{email}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <X size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.menuItems}>
              <TouchableOpacity style={styles.menuItem}>
                <Lock size={20} color="#6B7280" style={styles.menuIcon} />
                <View style={styles.menuItemContent}>
                  <Text style={styles.menuItemTitle}>{t('menu.passcode')}</Text>
                  <Text style={styles.menuItemSubtitle}>OFF</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem}>
                <DollarSign size={20} color="#6B7280" style={styles.menuIcon} />
                <View style={styles.menuItemContent}>
                  <Text style={styles.menuItemTitle}>{t('menu.mainCurrency')}</Text>
                  <Text style={styles.menuItemSubtitle}>LKR(Rs.)</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem}>
                <Wallet size={20} color="#6B7280" style={styles.menuIcon} />
                <View style={styles.menuItemContent}>
                  <Text style={styles.menuItemTitle}>{t('menu.subCurrency')}</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem}>
                <Bell size={20} color="#6B7280" style={styles.menuIcon} />
                <View style={styles.menuItemContent}>
                  <Text style={styles.menuItemTitle}>{t('menu.alarm')}</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem}>
                <Palette size={20} color="#6B7280" style={styles.menuIcon} />
                <View style={styles.menuItemContent}>
                  <Text style={styles.menuItemTitle}>{t('menu.style')}</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuItem} onPress={goToLanguage}>
                <Globe size={20} color="#6B7280" style={styles.menuIcon} />
                <View style={styles.menuItemContent}>
                  <Text style={styles.menuItemTitle}>{t('menu.language')}</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.menuItem, styles.logoutItem]} onPress={onLogout}>
                <LogOut size={20} color="#EF4444" style={styles.menuIcon} />
                <View style={styles.menuItemContent}>
                  <Text style={styles.logoutText}>{t('menu.logout')}</Text>
                </View>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

/* --------------------------------- Screen --------------------------------- */
export default function ChartsScreen({ onBack, onTransactions, onLogout }) {
  const { t } = useTranslation();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
          Alert.alert(t('common.error'), t('tx.msg.noUser'));
          setLoading(false);
          return;
        }

        const { data: allCategories, error: catError } = await supabase
          .from('categories')
          .select('id, name, icon, color, limit_')
          .or(`user_id.is.null,user_id.eq.${user.id}`)
          .order('id', { ascending: false });
        if (catError) throw catError;

        const { data: expenses, error: expenseErr } = await supabase
          .from('expenses')
          .select('category_id, amount')
          .eq('user_id', user.id);
        if (expenseErr) throw expenseErr;

        const spentMap = {};
        (expenses || []).forEach(e => {
          spentMap[e.category_id] = (spentMap[e.category_id] || 0) + Number(e.amount || 0);
        });

        setCategories(
          (allCategories || []).map(c => ({
            ...c,
            spent: spentMap[c.id] || 0,
            limit: c.limit_ || 0,
          }))
        );
      } catch (e) {
        Alert.alert(t('common.error'), e.message || 'Failed to load chart data');
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  const { totalSpent, listData, chartData, colorScale } = useMemo(() => {
    const total = categories.reduce((s, c) => s + (c.spent || 0), 0);

    // Hardcoded vibrant colors that will definitely work
    const VIBRANT_COLORS = [
      '#FF6B6B', // Red
      '#FFB366', // Orange
      '#FFE066', // Yellow
      '#66D9B3', // Teal
      '#66B3FF', // Blue
      '#A78BFA', // Purple
      '#FF6BD9', // Pink
      '#6BFFD9', // Cyan
      '#D966FF', // Magenta
      '#FFD966', // Gold
      '#66FFB3', // Mint
      '#FF66B3', // Rose
    ];

    const withPct = categories
      .filter(c => (c.spent || 0) > 0)
      .map((c, idx) => {
        // Use hardcoded colors instead of database colors
        const color = VIBRANT_COLORS[idx % VIBRANT_COLORS.length];
        return { ...c, color, percent: total === 0 ? 0 : ((c.spent || 0) / total) * 100 };
      })
      .sort((a, b) => b.percent - a.percent);

    // Build color array in the SAME order as withPct
    const scale = withPct.map(d => d.color);

    return {
      totalSpent: total,
      listData: withPct,
      chartData: withPct.map(c => ({
        x: c.name,
        y: c.spent || 0,
        percent: c.percent,
        emoji: c.icon,
      })),
      colorScale: scale.length > 0 ? scale : VIBRANT_COLORS,
    };
  }, [categories]);

  const toggleMoreMenu = () => setIsMoreMenuOpen(p => !p);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0D9488" />
        <Text style={styles.muted}>Loading charts…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#008080" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('charts.spendingByCategory')}</Text>
        <Text style={styles.totalText}>
          {t('charts.totalSpent', { amount: formatCurrency(totalSpent) })}
        </Text>
      </View>

      {/* Pie */}
      <View style={styles.chartWrapper}>
        {totalSpent === 0 ? (
          <Text style={styles.muted}>{t('tx.empty.title')}</Text>
        ) : (
          <VictoryPie
            data={chartData}
            colorScale={colorScale}
            animate={{ duration: 500 }}
            width={SCREEN_WIDTH}
            height={SCREEN_WIDTH * 0.75}
            padAngle={2}
            innerRadius={0}
            labels={({ datum }) =>
              `${datum.emoji || ''} ${datum.x}\n${datum.percent.toFixed(1)} %`
            }
            labelRadius={({ radius }) => radius + 22}
            style={{
              data: {
                stroke: '#FFFFFF',
                strokeWidth: 1,
              },
              labels: { fontSize: 13, fill: '#374151', textAlign: 'center' },
            }}
          />
        )}
      </View>

      {/* Legend / list */}
      <FlatList
        data={listData}
        keyExtractor={item => item.id?.toString() ?? item.name}
        contentContainerStyle={styles.listContainer}
        renderItem={({ item, index }) => {
          const color = item.color;
          const bg = hexToRgba(color, 0.16);
          return (
            <View style={styles.row}>
              <View style={[styles.badge, { backgroundColor: bg, borderColor: color }]}>
                <View style={[styles.colorDot, { backgroundColor: color }]} />
                <Text style={[styles.badgeText, { color }]}>{Math.round(item.percent)}%</Text>
              </View>
              <Text style={styles.name}>
                {item.icon ? `${item.icon} ` : ''}{item.name}
              </Text>
              <Text style={styles.amount}>{formatCurrency(item.spent || 0)}</Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.muted}>{t('tx.empty.title')}</Text>
          </View>
        }
      />

      {/* Bottom Nav */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={[styles.navItem, styles.navItemInactive]} onPress={onBack}>
          <Home size={24} color="white" />
          <Text style={styles.navText}>{t('nav.home')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.navItem, styles.navItemInactive]} onPress={onTransactions}>
          <DollarSign size={24} color="white" />
          <Text style={styles.navText}>{t('nav.transactions')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.navItem, styles.navItemInactive]}>
          <Wallet size={24} color="white" />
          <Text style={styles.navText}>{t('nav.accounts')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.navItem, styles.navItemInactive]} onPress={toggleMoreMenu}>
          <MoreHorizontal size={24} color="white" />
          <Text style={styles.navText}>{t('nav.more')}</Text>
        </TouchableOpacity>
      </View>

      <MoreMenu isOpen={isMoreMenuOpen} onClose={toggleMoreMenu} onLogout={onLogout} />
    </SafeAreaView>
  );
}

/* --------------------------------- styles --------------------------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#9CA3AF' },

  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#008080',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 20, fontWeight: '600', color: '#FFFFFF', marginBottom: 4 },
  totalText: { fontSize: 14, color: '#F3F4F6' },

  chartWrapper: { paddingVertical: 24, alignItems: 'center', justifyContent: 'center' },

  listContainer: { paddingHorizontal: 16, paddingBottom: 100 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  badge: {
    minWidth: 64,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  badgeText: { fontWeight: '700' },
  name: { flex: 1, fontSize: 16, fontWeight: '600', color: '#1F2937' },
  amount: { fontSize: 15, fontWeight: '700', color: '#111827' },

  bottomNav: {
    backgroundColor: '#008080',
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
  },
  navItem: { alignItems: 'center' },
  navItemInactive: { opacity: 0.7 },
  navText: { color: 'white', fontSize: 12, marginTop: 4 },

  // More menu
  moreModalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  moreBackdrop: { flex: 1 },
  moreMenu: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  moreMenuContent: { padding: 24 },
  moreMenuHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  profileSection: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  profileImage: { width: 48, height: 48, backgroundColor: '#008080', borderRadius: 24, overflow: 'hidden', marginRight: 12 },
  profileImageContent: { width: '100%', height: '100%' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 16, fontWeight: '600', color: '#1F2937' },
  profileEmail: { fontSize: 14, color: '#6B7280' },
  closeButton: { padding: 8 },
  menuItems: { flex: 1 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 8, borderRadius: 8, marginBottom: 4 },
  menuIcon: { marginRight: 16 },
  menuItemContent: { flex: 1 },
  menuItemTitle: { fontSize: 16, fontWeight: '500', color: '#1F2937' },
  menuItemSubtitle: { fontSize: 14, color: '#6B7280' },
  logoutItem: { marginTop: 32, backgroundColor: '#FEF2F2' },
  logoutText: { fontSize: 16, fontWeight: '500', color: '#EF4444' },
});
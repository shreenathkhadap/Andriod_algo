// InvestigationScreen.jsx
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  Image,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import RecentAlertRN from '../../components/Investigate/RecentAlertsRN';
import ProfileDropdown from '../../components/ProfileDropdown';
import { useAuth } from '../../context/AuthContext';
import AkshaLogo from '../../../assets/images/AkshaLogo.png';

const NAV_HEIGHT = Platform.OS === 'android'
  ? (StatusBar.currentHeight ?? 0) + 62
  : 100;

export default function InvestigationScreen() {
  const { user, signOut } = useAuth();
  const [profileVisible, setProfileVisible] = useState(false);

  // Tab screens stay mounted when you switch tabs (React Navigation doesn't
  // unmount them), so profileVisible would otherwise still be true the next
  // time you come back to this tab. Closing it on blur (this effect's
  // cleanup, which fires when the screen loses focus) matches how a
  // dropdown is expected to behave — never left open across a navigation.
  useFocusEffect(
    useCallback(() => {
      return () => setProfileVisible(false);
    }, [])
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#035faa" />

      {/* ── HEADER ── */}
      <View style={styles.nav}>
        <View style={styles.navLogo}>
          <View style={styles.logoIcon}>
            <Image source={AkshaLogo} style={styles.logoImage} resizeMode="contain" />
          </View>
          <View>
            <Text style={styles.logoBrand}>Aksha</Text>
            <Text style={styles.logoSub}>Recent alerts · last 4 hrs</Text>
          </View>
        </View>
        <View style={styles.navRight}>
          <TouchableOpacity
            style={styles.avatar}
            onPress={() => setProfileVisible((v) => !v)}
            activeOpacity={0.8}
          >
            <Text style={styles.avatarText}>
              {user?.username?.[0]?.toUpperCase() ??
                user?.email?.[0]?.toUpperCase() ?? 'A'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── PROFILE DROPDOWN ── */}
      <ProfileDropdown
        user={user}
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
        onSignOut={signOut}
        navHeight={NAV_HEIGHT}
      />

      {/* ── CONTENT ── */}
      <View style={styles.content}>
        <RecentAlertRN />
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1, backgroundColor: '#f1f5f9',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },

  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: '#035faa', zIndex: 10,
  },
  navLogo:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoIcon:   { width: 58, height: 58, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImage:  { width: 50, height: 50 },
  logoBrand:  { fontSize: 16, fontWeight: '600', color: '#fff', letterSpacing: -0.2 },
  logoSub:    { fontSize: 11, color: '#bfdbfe', marginTop: 2 },
  navRight:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn:    { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  avatar:     { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fbbf24', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '600', color: '#78350f' },

  content: { flex: 1 },
});
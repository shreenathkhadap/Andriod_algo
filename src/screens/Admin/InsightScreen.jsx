// InsightScreen.jsx
import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import {
  Image,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AkshaLogo from "../../../assets/images/AkshaLogo.png";
import AlertReportRN from "../../components/insight/AlertReportRN";
import NotificationMessagesRN from "../../components/insight/NotificationMessagesRN";
import ProfileDropdown from "../../components/ProfileDropdown";
import { useAuth } from "../../context/AuthContext";
import KpiReportScreen from "../KpiReportScreen";

const TABS = [
  { key: "notifications", label: "Notifications", icon: "notifications" },
  { key: "alert-report", label: "Alert Report", icon: "assessment" },
  { key: "kpi-report", label: "KPI Report", icon: "analytics" },
];

const NAV_HEIGHT =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 62 : 100;

function NotificationsTab({ user, focusAlert }) {
  return (
    <NotificationMessagesRN
      mobileId={user?.mobileId}
      token={user?.token}
      groupsApiUrl="https://hbzo58z4zk.execute-api.ap-south-1.amazonaws.com/prod/mobile/get-groups"
      alertsApiUrl="https://hbzo58z4zk.execute-api.ap-south-1.amazonaws.com/prod/mobile/alerts"
      apiMethod="post"
      focusAlert={focusAlert}
    />
  );
}

function AlertReportTab({ user }) {
  return (
    <AlertReportRN
      mobileId={user?.mobileId}
      token={user?.token}
      groupsApiUrl="https://hbzo58z4zk.execute-api.ap-south-1.amazonaws.com/prod/mobile/get-groups"
    />
  );
}

export default function InsightScreen() {
  const { user, signOut } = useAuth();
  const { tab, focusGroupId, focusCameraName, focusIncidentTime } =
    useLocalSearchParams();
  const [activeTab, setActiveTab] = useState(tab ?? "notifications");
  const [profileVisible, setProfileVisible] = useState(false);

  // Set only when a notification tap navigated here with an alert to jump
  // straight to (see app/_layout.jsx's navigateToNotifications) — lets
  // NotificationsTab auto-select that alert's group and scroll/highlight it
  // instead of just landing on whatever group happened to be selected.
  const focusAlert = focusGroupId
    ? {
        groupId: focusGroupId,
        cameraName: focusCameraName,
        incidentTime: focusIncidentTime,
      }
    : null;

  // Tab screens stay mounted when you switch tabs (React Navigation doesn't
  // unmount them), so profileVisible would otherwise still be true the next
  // time you come back to this tab. Closing it on blur (this effect's
  // cleanup, which fires when the screen loses focus) matches how a
  // dropdown is expected to behave — never left open across a navigation.
  useFocusEffect(
    useCallback(() => {
      return () => setProfileVisible(false);
    }, []),
  );

  // Sync active tab from the route param on every navigation into this
  // screen (e.g. a Home shortcut), not just when the param's VALUE changes.
  // A plain useEffect keyed on [tab] misses the case where you land here
  // again with the exact same tab value as last time (e.g. Home's
  // "Notifications" shortcut when tab was already 'notifications' from an
  // earlier visit) — React sees no dependency change and skips it, so a
  // manual in-screen tab switch since then never gets overridden back.
  // useFocusEffect fires on every actual focus event instead, regardless
  // of whether the param's value happens to match what it was before.
  useFocusEffect(
    useCallback(() => {
      if (tab) setActiveTab(tab);
    }, [tab]),
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#035faa" />

      {/* ── HEADER ── */}
      <View style={styles.nav}>
        <View style={styles.navLogo}>
          <View style={styles.logoIcon}>
            <Image
              source={AkshaLogo}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <View>
            <Text style={styles.logoBrand}>Aksha</Text>
            <Text style={styles.logoSub}>Insights</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.avatar}
          onPress={() => setProfileVisible((v) => !v)}
          activeOpacity={0.8}
        >
          <Text style={styles.avatarText}>
            {user?.username?.[0]?.toUpperCase() ??
              user?.email?.[0]?.toUpperCase() ??
              "A"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── TAB BAR — Design 1: pill tabs on blue ── */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
            >
              <MaterialIcons
                name={tab.icon}
                size={18}
                color={isActive ? "#035faa" : "rgba(255,255,255,0.6)"}
              />
              <Text
                style={[styles.tabLabel, isActive && styles.tabLabelActive]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── PROFILE DROPDOWN ── */}
      <ProfileDropdown
        user={user}
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
        onSignOut={signOut}
        navHeight={NAV_HEIGHT}
      />

      {/* ── TAB CONTENT ── */}
      <View style={styles.content}>
        {activeTab === "notifications" && (
          <NotificationsTab user={user} focusAlert={focusAlert} />
        )}
        {activeTab === "alert-report" && <AlertReportTab user={user} />}
        {activeTab === "kpi-report" && (
          <KpiReportScreen
            token={user?.token}
            kpiApiUrl={process.env.EXPO_PUBLIC_KPI_REPORT_URL}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f1f5f9",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },

  // ── Nav — matches HomeScreen ──
  nav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: "#035faa",
    zIndex: 10,
  },
  navLogo: { flexDirection: "row", alignItems: "center", gap: 12 },
  logoIcon: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImage: { width: 50, height: 50 },
  logoBrand: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    letterSpacing: -0.2,
  },
  logoSub: { fontSize: 11, color: "#bfdbfe", marginTop: 2 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#fbbf24",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontWeight: "600", color: "#78350f" },

  // ── Tab bar — Design 1: pill tabs ──
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#035faa",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  tabActive: { backgroundColor: "#fff" },
  tabLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255,255,255,0.65)",
  },
  tabLabelActive: { color: "#035faa", fontWeight: "600" },

  content: { flex: 1 },
});

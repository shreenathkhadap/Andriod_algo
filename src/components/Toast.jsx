import { MaterialIcons } from "@expo/vector-icons";
import { useEffect } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

// Self-dismissing banner shown near the top of the screen for a few seconds.
export default function Toast({ text, visible, onClose }) {
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => onClose?.(), 2500);
    return () => clearTimeout(t);
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.toast}>
      <MaterialIcons name="info-outline" size={14} color="#035faa" />
      <Text style={styles.toastText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute", top: 14, left: 16, right: 16,
    backgroundColor: "#fff", padding: 10, borderRadius: 10,
    borderWidth: 0.5, borderColor: "#bfdbfe",
    flexDirection: "row", alignItems: "center", gap: 8, zIndex: 999,
    ...Platform.select({
      ios:     { shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8 },
      android: { elevation: 6 },
    }),
  },
  toastText: { fontSize: 13, color: "#0f172a", flex: 1 },
});

import { MaterialIcons } from "@expo/vector-icons";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function ImageActionBar({ url, downloadingUrl, sharingUrl, onDownload, onShare }) {
  if (!url) return null;
  const isDownloading = downloadingUrl === url;
  const isSharing     = sharingUrl === url;

  return (
    <View style={styles.modalActions}>
      <TouchableOpacity
        style={styles.modalActionBtn}
        onPress={() => onDownload(url)}
        activeOpacity={isDownloading ? 1 : 0.7}
        disabled={isDownloading}
      >
        {isDownloading ? <ActivityIndicator size="small" color="#fff" /> : (
          <>
            <MaterialIcons name="file-download" size={20} color="#fff" />
            <Text style={styles.modalActionText}>Save to Gallery</Text>
          </>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.modalActionBtn}
        onPress={() => onShare(url)}
        activeOpacity={isSharing ? 1 : 0.7}
        disabled={isSharing}
      >
        {isSharing ? <ActivityIndicator size="small" color="#fff" /> : (
          <>
            <MaterialIcons name="share" size={20} color="#fff" />
            <Text style={styles.modalActionText}>Share</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  modalActions: { position: "absolute", bottom: 40, flexDirection: "row", gap: 12, paddingHorizontal: 20, width: "100%" },
  modalActionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 12, paddingVertical: 12, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.25)" },
  modalActionText: { color: "#fff", fontWeight: "600", fontSize: 13 },
});

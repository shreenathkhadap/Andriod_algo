import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert } from "react-native";

export default function useImageActions(albumName = "Aksha Alerts") {
  const [downloadingUrl, setDownloadingUrl] = useState(null);
  const [sharingUrl, setSharingUrl] = useState(null);

  const downloadImage = async (url) => {
    if (!url) return;
    setDownloadingUrl(url);
    try {
      const localUri = FileSystem.cacheDirectory + `aksha_alert_${Date.now()}.jpg`;
      const { uri }  = await FileSystem.downloadAsync(url, localUri);
      const asset    = await MediaLibrary.createAssetAsync(uri);
      await MediaLibrary.createAlbumAsync(albumName, asset, false);
      Alert.alert("Saved!", `Image saved to ${albumName} album.`);
    } catch (err) {
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission needed", "Go to Settings → Apps → Aksha → Permissions → Files and media → Allow.");
          return;
        }
        const localUri = FileSystem.cacheDirectory + `aksha_alert_${Date.now()}.jpg`;
        const { uri }  = await FileSystem.downloadAsync(url, localUri);
        const asset    = await MediaLibrary.createAssetAsync(uri);
        await MediaLibrary.createAlbumAsync(albumName, asset, false);
        Alert.alert("Saved!", `Image saved to ${albumName} album.`);
      } catch (retryErr) {
        Alert.alert("Failed", retryErr.message);
      }
    } finally {
      setDownloadingUrl(null);
    }
  };

  const shareImage = async (url) => {
    if (!url) return;
    setSharingUrl(url);
    try {
      const localUri = FileSystem.cacheDirectory + `aksha_alert_${Date.now()}.jpg`;
      const { uri }  = await FileSystem.downloadAsync(url, localUri);
      await Sharing.shareAsync(uri, { mimeType: "image/jpeg", dialogTitle: "Share Alert Image", UTI: "public.jpeg" });
    } catch (err) {
      Alert.alert("Failed", err.message);
    } finally {
      setSharingUrl(null);
    }
  };

  return { downloadImage, shareImage, downloadingUrl, sharingUrl };
}

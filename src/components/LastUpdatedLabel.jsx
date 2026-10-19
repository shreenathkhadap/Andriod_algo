import { MaterialIcons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

dayjs.extend(relativeTime);

// Surfaces the shared alerts store's `lastUpdated` and `refreshing` state —
// both tracked already but never previously shown anywhere. Re-renders (and
// so visibly ticks forward / flips to "Syncing…") whenever the host screen
// re-renders, which happens on every refresh trigger already wired up
// (AppState resume, push event, 15s interval, focus) — no separate timer
// needed here.
export default function LastUpdatedLabel({ timestamp, refreshing, style }) {
  return (
    <View style={[styles.wrap, style]}>
      {refreshing ? (
        <>
          <ActivityIndicator size="small" color="#0A57EB" />
          <Text style={styles.syncingText}>Syncing…</Text>
        </>
      ) : (
        <>
          <MaterialIcons name="schedule" size={12} color="#94a3b8" />
          <Text style={styles.text}>
            {timestamp ? `Updated ${dayjs(timestamp).fromNow()}` : 'Not synced yet'}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { fontSize: 11, color: '#94a3b8' },
  syncingText: { fontSize: 11, color: '#0A57EB', fontWeight: '600' },
});

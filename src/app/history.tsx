import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { fetchHistory, type MatchRow } from '@/lib/db';

export default function HistoryScreen() {
  const { session, loading } = useSession();
  const theme = useTheme();
  const userId = session?.user.id;
  const [rows, setRows] = useState<MatchRow[]>([]);

  // Data comes from the network, so rows land after the effect rather than
  // during it. Signed-out renders simply read the empty initial state.
  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchHistory(userId)
      .then((next) => {
        if (active) setRows(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [userId]);

  function refresh() {
    if (!userId) return;
    fetchHistory(userId).then(setRows).catch(() => undefined);
  }

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </ThemedView>
    );
  }

  if (!session?.user) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="small">Sign in to see your history.</ThemedText>
      </ThemedView>
    );
  }

  const myId = userId;
  // Only confirmed results count towards the record; the rest are still in flight.
  const settled = rows.filter((r) => r.status === 'confirmed');
  const wins = settled.filter((r) => (r.player_id === myId ? r.player_won : !r.player_won)).length;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title">History</ThemedText>

          <Pressable
            onPress={refresh}
            accessibilityRole="button"
            accessibilityLabel="Refresh history">
            <ThemedText type="link">Refresh</ThemedText>
          </Pressable>

          <ThemedText type="small">
            {settled.length} confirmed · {wins} won
            {rows.length !== settled.length && ` · ${rows.length - settled.length} unconfirmed`}
          </ThemedText>

          {rows.length === 0 && (
            <ThemedText type="small">Nothing logged yet. Log your first match.</ThemedText>
          )}

          {rows.map((r) => {
            const iWon = r.player_id === myId ? r.player_won : !r.player_won;
            const mine = r.player_id === myId ? r.player_sets : r.opponent_sets;
            const theirs = r.player_id === myId ? r.opponent_sets : r.player_sets;
            const after = r.player_id === myId ? r.player_rating_after : r.opponent_rating_after;
            return (
              <ThemedView key={r.id} type="backgroundElement" style={styles.row}>
                <ThemedText type="default" themeColor={r.status === 'confirmed' ? (iWon ? 'positive' : 'negative') : 'textSecondary'}>
                  {mine}–{theirs} {iWon ? 'W' : 'L'}
                </ThemedText>
                <ThemedText type="small">
                  {r.tag} · {r.status}
                </ThemedText>
                <ThemedText type="small">{after != null ? `→ ${after}` : 'no rating change yet'}</ThemedText>
              </ThemedView>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  scroll: { padding: Spacing.four, gap: Spacing.two, paddingBottom: Spacing.six },
  row: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.one },
});
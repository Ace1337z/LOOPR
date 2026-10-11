import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { fetchPendingForMe, fetchProfile, respondToMatch, type MatchRow } from '@/lib/db';

export default function ConfirmScreen() {
  const userId = useSession().session?.user.id;
  const theme = useTheme();
  const [pending, setPending] = useState<MatchRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!userId) return;
    fetchPendingForMe()
      .then(async (rows) => {
        setPending(rows);
        // Resolve who is claiming each result, so the player knows who to trust
        // before approving.
        const ids = [...new Set(rows.map((r) => r.player_id))];
        if (ids.length === 0) return;
        const results = await Promise.all(ids.map((id) => fetchProfile(id)));
        setNames(
          Object.fromEntries(
            ids.map((id, i) => [id, results[i]?.display_name ?? 'Unknown player']),
          ),
        );
      })
      .catch((e: unknown) =>
        Alert.alert('Could not load', e instanceof Error ? e.message : String(e)),
      );
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(row: MatchRow, approved: boolean) {
    setBusyId(row.id);
    try {
      await respondToMatch(row.id, approved, approved ? undefined : reason || 'Score was different');
      if (!approved) setReason('');
      load();
    } catch (e) {
      Alert.alert('Could not respond', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!userId) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="small">Sign in to confirm results.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title">Confirm</ThemedText>
          <ThemedText type="small">
            Only confirm a score you agree with. Disputing costs you nothing — no rating moves until you
            approve.
          </ThemedText>

          {pending.length === 0 && (
            <ThemedText type="small">Nothing waiting on you.</ThemedText>
          )}

          {pending.map((row) => {
            const theyWon = !row.player_won;
            return (
              <ThemedView key={row.id} type="backgroundElement" style={styles.card}>
                <ThemedText type="default">{names[row.player_id] ?? 'Player'}</ThemedText>
                <ThemedText type="title" style={styles.score}>
                  {theyWon ? row.opponent_sets : row.player_sets}–
                  {theyWon ? row.player_sets : row.opponent_sets}
                </ThemedText>
                <ThemedText type="small">
                  {theyWon ? 'claims they beat you' : 'claims they lost to you'} · {row.tag} · best of{' '}
                  {row.best_of}
                </ThemedText>
                {row.note ? <ThemedText type="small">“{row.note}”</ThemedText> : null}

                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder="If disputing, say what actually happened"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { borderColor: theme.textSecondary }]}
                />

                <View style={styles.row}>
                  <Pressable
                    onPress={() => respond(row, false)}
                    disabled={busyId === row.id}
                    style={[styles.action, { backgroundColor: theme.negative }]}>
                    <ThemedText type="default">Dispute</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => respond(row, true)}
                    disabled={busyId === row.id}
                    style={[styles.action, { backgroundColor: theme.positive }]}>
                    <ThemedText type="default">
                      {busyId === row.id ? 'Saving…' : 'Confirm'}
                    </ThemedText>
                  </Pressable>
                </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  card: { padding: Spacing.three, gap: Spacing.two, borderRadius: Spacing.four },
  score: { fontSize: 40 },
  row: { flexDirection: 'row', gap: Spacing.two },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  action: { flex: 1, padding: Spacing.three, borderRadius: Spacing.two, alignItems: 'center' },
});
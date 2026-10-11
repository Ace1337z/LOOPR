import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useOrganiserAccess } from '@/hooks/use-organiser-access';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import {
  createTournament,
  enterTournament,
  fetchDisputes,
  fetchEntrants,
  fetchOpponentCandidates,
  fetchTournaments,
  isAdmin,
  recordTournamentResult,
  resolveDispute,
  type MatchRow,
  type Tournament,
} from '@/lib/db';
import { INITIAL_SCORE, adjust, isFinished, winnerOf, type Score } from '@/lib/score';

type Panel = 'tournaments' | 'disputes';

export default function AdminScreen() {
  const { session } = useSession();
  const theme = useTheme();
  const { isOrganiser: allowed, loading: checking } = useOrganiserAccess(session?.user.id);
  const [admin, setAdmin] = useState(false);
  const [panel, setPanel] = useState<Panel>('tournaments');

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState<Tournament | null>(null);
  const [entrants, setEntrants] = useState<{ player_id: string; display_name: string; rating_snapshot: number }[]>([]);
  const [disputes, setDisputes] = useState<MatchRow[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!allowed) return;
    fetchTournaments().then(setTournaments).catch(() => undefined);
    if (admin) fetchDisputes().then(setDisputes).catch(() => undefined);
  }, [allowed, admin]);

  useEffect(() => {
    if (!session?.user) return;
    isAdmin().then(setAdmin).catch(() => setAdmin(false));
  }, [session?.user]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function makeTournament() {
    if (!name.trim()) {
      Alert.alert('Name needed', 'Give the tournament a name.');
      return;
    }
    setBusy(true);
    try {
      await createTournament(name.trim(), date);
      setName('');
      reload();
    } catch (e) {
      Alert.alert('Could not create', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function open(t: Tournament) {
    setSelected(t);
    setEntrants([]);
    try {
      const list = await fetchEntrants(t.id);
      if (list.length === 0) {
        // Nobody entered yet. Seed from every known player so an organiser can
        // record a small club event without a separate draw-building step.
        const all = await fetchOpponentCandidates(session!.user.id);
        const ids = all.map((p) => p.id);
        if (ids.length >= 2) {
          await enterTournament(t.id, ids);
          setEntrants(await fetchEntrants(t.id));
        }
        return;
      }
      setEntrants(list);
    } catch (e) {
      Alert.alert('Could not load entrants', e instanceof Error ? e.message : String(e));
    }
  }

  if (!session?.user || checking) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </ThemedView>
    );
  }

  if (!allowed) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="subtitle">Staff only</ThemedText>
        <ThemedText type="small">
          Ask an administrator for an invite code, then redeem it on the Sign In tab.
        </ThemedText>
      </ThemedView>
    );
  }

  const input = [styles.input, { borderColor: theme.textSecondary }];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title">{admin ? 'Admin' : 'Organiser'}</ThemedText>

          {admin && (
            <View style={styles.row}>
              <Pressable
                onPress={() => setPanel('tournaments')}
                style={[styles.chip, { borderColor: panel === 'tournaments' ? theme.accent : 'transparent' }]}>
                <ThemedText type="small">Tournaments</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setPanel('disputes')}
                style={[styles.chip, { borderColor: panel === 'disputes' ? theme.accent : 'transparent' }]}>
                <ThemedText type="small">Disputes ({disputes.length})</ThemedText>
              </Pressable>
            </View>
          )}

          {panel === 'disputes' && admin ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="subtitle">Disputed matches</ThemedText>
              {disputes.length === 0 && <ThemedText type="small">Nothing to review.</ThemedText>}
              {disputes.map((m) => (
                <View key={m.id} style={styles.dispute}>
                  <ThemedText type="small">
                    {m.player_sets}–{m.opponent_sets} · {m.tag}
                  </ThemedText>
                  {m.disputed_reason ? (
                    <ThemedText type="small">Reason: {m.disputed_reason}</ThemedText>
                  ) : null}
                  <View style={styles.row}>
                    <Pressable
                      onPress={() =>
                        resolveDispute(m.id, false)
                          .then(reload)
                          .catch((e: unknown) =>
                            Alert.alert('Failed', e instanceof Error ? e.message : String(e)),
                          )
                      }
                      style={[styles.action, { backgroundColor: theme.negative }]}>
                      <ThemedText type="small">Void</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        resolveDispute(m.id, true)
                          .then(reload)
                          .catch((e: unknown) =>
                            Alert.alert('Failed', e instanceof Error ? e.message : String(e)),
                          )
                      }
                      style={[styles.action, { backgroundColor: theme.positive }]}>
                      <ThemedText type="small">Confirm anyway</ThemedText>
                    </Pressable>
                  </View>
                </View>
              ))}
            </ThemedView>
          ) : (
            <>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="subtitle">New tournament</ThemedText>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Selangor Open"
                  placeholderTextColor={theme.textSecondary}
                  style={input}
                />
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  placeholder="2026-05-02"
                  placeholderTextColor={theme.textSecondary}
                  style={input}
                />
                <Pressable onPress={makeTournament} disabled={busy} style={[styles.submit, busy && { opacity: 0.5 }]}>
                  <ThemedText type="default">{busy ? 'Saving…' : 'Create'}</ThemedText>
                </Pressable>
              </ThemedView>

              {tournaments.map((t) => (
                <ThemedView key={t.id} type="backgroundElement" style={styles.card}>
                  <ThemedText type="default">{t.name}</ThemedText>
                  <ThemedText type="small">
                    {t.date} · {t.organisation}
                  </ThemedText>
                  <Pressable
                    onPress={() => open(t)}
                    style={[styles.action, { backgroundColor: theme.accent }]}>
                    <ThemedText type="small">Open</ThemedText>
                  </Pressable>
                </ThemedView>
              ))}

              {selected && (
                <ThemedView type="backgroundElement" style={styles.card}>
                  <ThemedText type="subtitle">{selected.name}</ThemedText>
                  <ThemedText type="small">
                    {entrants.length} entrants, seeded strongest first. Every result is scored
                    against the best player entered other than the two involved, so seed order
                    decides what a win is worth.
                  </ThemedText>
                  <TournamentEntryList
                    tournamentId={selected.id}
                    entrants={entrants}
                    onRecorded={() => open(selected)}
                  />
                </ThemedView>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

/**
 * Pick two entrants, step the score, record. The rating is never entered here:
 * the database derives it from the field average.
 */
function TournamentEntryList({
  tournamentId,
  entrants,
  onRecorded,
}: {
  tournamentId: string;
  entrants: { player_id: string; display_name: string; rating_snapshot: number }[];
  onRecorded: () => void;
}) {
  const theme = useTheme();
  const [winner, setWinner] = useState<string | null>(null);
  const [loser, setLoser] = useState<string | null>(null);
  const [score, setScore] = useState<Score>(INITIAL_SCORE);
  const [busy, setBusy] = useState(false);

  async function record() {
    const w = winnerOf(score);
    if (!winner || !loser || !w) return;
    const winnerId = w === 'mine' ? winner : loser;
    const loserId = w === 'mine' ? loser : winner;
    setBusy(true);
    try {
      await recordTournamentResult({
        tournamentId,
        playerId: winnerId,
        opponentId: loserId,
        playerWon: w === 'mine',
        playerSets: score.mine,
        opponentSets: score.theirs,
        bestOf: score.format,
      });
      setScore(INITIAL_SCORE);
      setWinner(null);
      setLoser(null);
      onRecorded();
    } catch (e) {
      Alert.alert('Could not record', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ThemedText type="default">Winner</ThemedText>
      <View style={styles.wrap}>
        {entrants.map((p) => (
          <Pressable
            key={p.player_id}
            onPress={() => setWinner(p.player_id)}
            style={[styles.chip, { borderColor: winner === p.player_id ? theme.accent : 'transparent' }]}>
            <ThemedText type="small">
              {p.display_name} ({p.rating_snapshot})
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <ThemedText type="default">Loser</ThemedText>
      <View style={styles.wrap}>
        {entrants
          .filter((p) => p.player_id !== winner)
          .map((p) => (
            <Pressable
              key={p.player_id}
              onPress={() => setLoser(p.player_id)}
              style={[styles.chip, { borderColor: loser === p.player_id ? theme.accent : 'transparent' }]}>
              <ThemedText type="small">
                {p.display_name} ({p.rating_snapshot})
              </ThemedText>
            </Pressable>
          ))}
      </View>

      <View style={styles.row}>
        <Pressable
          onPress={() => setScore((s) => (isFinished(s) ? s : adjust(s, 'mine', 1)))}
          style={styles.step}>
          <ThemedText type="subtitle">W+</ThemedText>
        </Pressable>
        <ThemedText type="title">
          {score.mine}–{score.theirs}
        </ThemedText>
        <Pressable
          onPress={() => setScore((s) => (isFinished(s) ? s : adjust(s, 'theirs', 1)))}
          style={styles.step}>
          <ThemedText type="subtitle">L+</ThemedText>
        </Pressable>
      </View>

      <Pressable
        onPress={record}
        disabled={busy || !winner || !loser || !isFinished(score)}
        style={[
          styles.submit,
          (busy || !winner || !loser || !isFinished(score)) && { opacity: 0.4 },
        ]}>
        <ThemedText type="default">{busy ? 'Saving…' : 'Record result'}</ThemedText>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  card: { padding: Spacing.three, gap: Spacing.two, borderRadius: Spacing.four },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.four,
    borderWidth: 2,
  },
  step: { paddingHorizontal: Spacing.three },
  dispute: { gap: Spacing.one, paddingVertical: Spacing.two },
  input: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  action: { padding: Spacing.two, borderRadius: Spacing.two, alignItems: 'center' },
  submit: { backgroundColor: '#D9400F', borderRadius: Spacing.two, padding: Spacing.three, alignItems: 'center' },
});
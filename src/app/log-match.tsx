import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { fetchOpponentCandidates, fetchProfile, submitMatch, type Profile } from '@/lib/db';
import type { MatchTag } from '@/lib/elo';
import {
  INITIAL_SCORE,
  adjust,
  isFinished,
  winnerOf,
  type Score,
} from '@/lib/score';

const TAGS: MatchTag[] = ['friendly', 'training', 'ladder', 'league'];

export default function LogMatchScreen() {
  const { session, loading } = useSession();
  const theme = useTheme();
  const [candidates, setCandidates] = useState<Profile[]>([]);
  const [opponent, setOpponent] = useState<Profile | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [score, setScore] = useState<Score>(INITIAL_SCORE);
  const [tag, setTag] = useState<MatchTag>('friendly');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    let active = true;
    Promise.all([fetchOpponentCandidates(session.user.id), fetchProfile(session.user.id)])
      .then(([cs, p]) => {
        if (!active) return;
        setCandidates(cs);
        setMe(p);
        setOpponent(cs[0] ?? null);
      })
      .catch((e: unknown) =>
        Alert.alert('Could not load players', e instanceof Error ? e.message : String(e)),
      );
    return () => {
      active = false;
    };
  }, [session?.user]);

  function bump(side: 'mine' | 'theirs') {
    setScore((s) => (isFinished(s) ? s : adjust(s, side, 1)));
  }

  function step(side: 'mine' | 'theirs', delta: 1 | -1) {
    setScore((s) => adjust(s, side, delta));
  }

  async function submit() {
    if (!opponent) return;
    const winner = winnerOf(score);
    if (!winner) {
      Alert.alert('Match not over', 'Play the score out to the winning set first.');
      return;
    }
    setBusy(true);
    try {
      await submitMatch({
        opponentId: opponent.id,
        playerWon: winner === 'mine',
        playerSets: score.mine,
        opponentSets: score.theirs,
        bestOf: score.format,
        tag,
      });
      // No rating has moved yet: the opponent has to agree first.
      Alert.alert(
        'Sent for confirmation',
        `${opponent.display_name} has been asked to confirm this result. Your ELO changes once they do.`,
      );
      setScore(INITIAL_SCORE);
    } catch (e) {
      Alert.alert('Could not submit match', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !session?.user) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title">Log match</ThemedText>
          <ThemedText type="small">
            Your opponent confirms the result before either rating moves.
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="subtitle">Opponent</ThemedText>
            {candidates.length === 0 && (
              <ThemedText type="small">
                No other players yet. Invite a training partner to get started.
              </ThemedText>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.row}>
                {candidates.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => setOpponent(p)}
                    style={[
                      styles.chip,
                      { borderColor: opponent?.id === p.id ? theme.accent : 'transparent' },
                    ]}>
                    <ThemedText type="default">{p.display_name}</ThemedText>
                    <ThemedText type="small">{p.casual_rating}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            {opponent && me && (
              <ThemedText type="small">
                {expectedLine(me.casual_rating, opponent.casual_rating)} · you are the{' '}
                {me.casual_rating >= opponent.casual_rating ? 'stronger' : 'underdog'}
              </ThemedText>
            )}
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="subtitle">Result</ThemedText>
            <ThemedText type="small">
              Best of {score.format}
              {score.format === 3 && score.mine + score.theirs >= 2
                ? ' · a fifth set makes it best of 5'
                : ''}
            </ThemedText>

            <View style={styles.scorer}>
              <Stepper
                label="You"
                value={score.mine}
                onPlus={() => bump('mine')}
                onMinus={() => step('mine', -1)}
              />
              <Stepper
                label={opponent?.display_name ?? 'Them'}
                value={score.theirs}
                onPlus={() => bump('theirs')}
                onMinus={() => step('theirs', -1)}
              />
            </View>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="subtitle">Type</ThemedText>
            <View style={styles.row}>
              {TAGS.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setTag(t)}
                  style={[
                    styles.chip,
                    { borderColor: tag === t ? theme.accent : 'transparent' },
                  ]}>
                  <ThemedText type="small">{t}</ThemedText>
                </Pressable>
              ))}
            </View>
            <ThemedText type="small">
              {tag === 'training' && 'Training moves your rating least — it is practice, not a result.'}
              {tag === 'friendly' && 'Friendly matches count at 80%.'}
              {(tag === 'ladder' || tag === 'league') && 'Full weight. Use for competitive results only.'}
            </ThemedText>
          </ThemedView>

          <Pressable
            onPress={submit}
            disabled={busy || !opponent || !isFinished(score)}
            style={[styles.submit, (busy || !opponent || !isFinished(score)) && { opacity: 0.4 }]}>
            <ThemedText type="default">{busy ? 'Sending…' : 'Send for confirmation'}</ThemedText>
          </Pressable>

          {me && (
            <ThemedText type="small" style={styles.after}>
              {me.casual_rating} across {me.casual_games} confirmed matches
            </ThemedText>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function expectedLine(mine: number, theirs: number) {
  const pct = Math.round(100 / (1 + 10 ** ((theirs - mine) / 400)));
  return `You win about ${pct}% of these`;
}

function Stepper({
  label,
  value,
  onPlus,
  onMinus,
}: {
  label: string;
  value: number;
  onPlus: () => void;
  onMinus: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.stepper}>
      <ThemedText type="small">{label}</ThemedText>
      <View style={styles.row}>
        <Pressable onPress={onMinus} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`Remove a set from ${label}`}>
          <ThemedText type="subtitle">−</ThemedText>
        </Pressable>
        <ThemedText type="title" style={{ color: theme.text, fontSize: 32 }}>
          {value}
        </ThemedText>
        <Pressable onPress={onPlus} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`Add a set for ${label}`}>
          <ThemedText type="subtitle">+</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  scroll: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  card: { padding: Spacing.three, gap: Spacing.two, borderRadius: Spacing.four },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
    borderWidth: 2,
  },
  scorer: { gap: Spacing.three },
  stepper: { gap: Spacing.one },
  stepBtn: { paddingHorizontal: Spacing.three },
  submit: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    backgroundColor: '#D9400F',
  },
  after: { textAlign: 'center' },
});
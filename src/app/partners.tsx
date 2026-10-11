import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { fetchProfile, type Profile } from '@/lib/db';
import {
  AVAILABILITY_SLOTS,
  citiesFrom,
  findPartners,
  withinWindow,
  type Availability,
  type PartnerProfile,
} from '@/lib/partners';

const WINDOWS = [
  { value: 50, label: '±50' },
  { value: 150, label: '±150' },
  { value: 400, label: '±400' },
  { value: 9999, label: 'Any' },
];

export default function PartnersScreen() {
  const { session, loading } = useSession();
  const theme = useTheme();
  const [me, setMe] = useState<PartnerProfile | null>(null);
  const [players, setPlayers] = useState<PartnerProfile[]>([]);
  const [window, setWindow] = useState(150);
  const [city, setCity] = useState<string | null>(null);
  const [slot, setSlot] = useState<Availability | 'any'>('any');

  useEffect(() => {
    if (!session?.user) return;
    let active = true;
    Promise.all([fetchProfile(session.user.id), findPartners(session.user.id, { ratingWindow: 9999, city: null, availability: 'any' })])
      .then(([p, all]) => {
        if (!active) return;
        setMe(p as PartnerProfile | null);
        setPlayers(all);
      })
      .catch((e: unknown) =>
        Alert.alert('Could not load players', e instanceof Error ? e.message : String(e)),
      );
    return () => {
      active = false;
    };
  }, [session?.user]);

  const cities = useMemo(() => citiesFrom(players), [players]);

  const shown = useMemo(() => {
    if (!me) return [];
    return players
      .filter((p) => withinWindow(me, p, window))
      .filter((p) => (city ? p.city === city : true))
      .filter((p) =>
        slot === 'any' ? true : p.availability.length === 0 || p.availability.includes(slot),
      );
  }, [me, players, window, city, slot]);

  if (loading || !session?.user || !me) {
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
          <ThemedText type="title">Partners</ThemedText>
          <ThemedText type="small">
            {shown.length} player{shown.length === 1 ? '' : 's'} near your level.
          </ThemedText>

          <View style={styles.filters}>
            {WINDOWS.map((w) => (
              <Pressable
                key={w.value}
                onPress={() => setWindow(w.value)}
                style={[styles.chip, { borderColor: window === w.value ? theme.accent : 'transparent' }]}>
                <ThemedText type="small">{w.label}</ThemedText>
              </Pressable>
            ))}
          </View>

          <View style={styles.filters}>
            <Pressable
              onPress={() => setSlot('any')}
              style={[styles.chip, { borderColor: slot === 'any' ? theme.accent : 'transparent' }]}>
              <ThemedText type="small">Any time</ThemedText>
            </Pressable>
            {AVAILABILITY_SLOTS.map((a) => (
              <Pressable
                key={a.value}
                onPress={() => setSlot(a.value)}
                style={[styles.chip, { borderColor: slot === a.value ? theme.accent : 'transparent' }]}>
                <ThemedText type="small">{a.label}</ThemedText>
              </Pressable>
            ))}
          </View>

          {cities.length > 0 && (
            <View style={styles.filters}>
              <Pressable
                onPress={() => setCity(null)}
                style={[styles.chip, { borderColor: city === null ? theme.accent : 'transparent' }]}>
                <ThemedText type="small">All cities</ThemedText>
              </Pressable>
              {cities.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setCity(c)}
                  style={[styles.chip, { borderColor: city === c ? theme.accent : 'transparent' }]}>
                  <ThemedText type="small">{c}</ThemedText>
                </Pressable>
              ))}
            </View>
          )}

          {shown.length === 0 && (
            <ThemedText type="small">
              Nobody in range yet. Widen the rating band, or invite a training partner.
            </ThemedText>
          )}

          {shown.map((p) => (
            <PartnerCard key={p.id} player={p} viewer={me} />
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function PartnerCard({ player, viewer }: { player: PartnerProfile; viewer: PartnerProfile }) {
  const theme = useTheme();
  const gap = viewer ? player.casual_rating - viewer.casual_rating : 0;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.rowBetween}>
        <ThemedText type="default">{player.display_name}</ThemedText>
        <ThemedText
          type="default"
          themeColor={gap > 0 ? 'positive' : gap < 0 ? 'negative' : 'textSecondary'}>
          {player.casual_rating}
        </ThemedText>
      </View>

      <ThemedText type="small">
        {gap === 0 ? 'your level' : `${gap > 0 ? '+' : ''}${gap} vs you`} · {player.casual_games}{' '}
        matches
      </ThemedText>

      <View style={styles.metaRow}>
        <ThemedText type="small">{player.city ?? 'City not set'}</ThemedText>
        {player.age_band && <ThemedText type="small">{player.age_band}</ThemedText>}
        {player.grip && <ThemedText type="small">{player.grip}</ThemedText>}
      </View>

      {player.blade && <ThemedText type="small">{player.blade}</ThemedText>}
      <ThemedText type="small" style={{ color: theme.textSecondary }}>
        {describeSetup(player)}
      </ThemedText>

      {player.availability.length > 0 && (
        <View style={styles.metaRow}>
          {player.availability.map((a) => (
            <ThemedText key={a} type="small" style={{ color: theme.accent }}>
              {AVAILABILITY_SLOTS.find((s) => s.value === a)?.label ?? a}
            </ThemedText>
          ))}
        </View>
      )}
    </ThemedView>
  );
}

function describeSetup(p: PartnerProfile): string {
  const parts = [];
  if (p.fh_rubber) parts.push(`FH ${p.fh_rubber}`);
  if (p.bh_rubber) parts.push(`BH ${p.bh_rubber}`);
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  scroll: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.four,
    borderWidth: 2,
  },
  card: { padding: Spacing.three, gap: Spacing.one, borderRadius: Spacing.four },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
});
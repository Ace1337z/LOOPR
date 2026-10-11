import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { fetchProfile, updateProfile, type Profile } from '@/lib/db';
import { AVAILABILITY_SLOTS, type Availability } from '@/lib/partners';
import { useTheme } from '@/hooks/use-theme';

const GRIPS = ['shakehand', 'penhold'] as const;

export default function ProfileScreen() {
  const { session, loading } = useSession();
  const theme = useTheme();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.user) return;
    let active = true;
    fetchProfile(session.user.id)
      .then((p) => {
        if (!active || !p) return;
        setProfile(p);
        setCity(p.city ?? '');
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [session?.user]);

  if (loading || (session?.user && !profile)) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </ThemedView>
    );
  }

  if (!session?.user) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="title">LOOPR</ThemedText>
        <ThemedText type="small">Sign in from the Sign In tab.</ThemedText>
      </ThemedView>
    );
  }

  function patch<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  }

  function toggleSlot(slot: Availability) {
    setProfile((p) => {
      if (!p) return p;
      const current = (p.availability ?? []) as Availability[];
      const next = current.includes(slot)
        ? current.filter((s) => s !== slot)
        : [...current, slot];
      return { ...p, availability: next };
    });
  }

  async function save() {
    if (!session?.user || !profile) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      // Every editable field has to be sent. An earlier version only sent the
      // city, which silently discarded blade, rubbers and grip.
      await updateProfile(session.user.id, {
        display_name: profile.display_name,
        blade: profile.blade || null,
        fh_rubber: profile.fh_rubber || null,
        bh_rubber: profile.bh_rubber || null,
        grip: profile.grip || null,
        city: city || null,
        availability: profile.availability ?? [],
        rating_visible: profile.rating_visible,
      });
      setSaved(true);
      const fresh = await fetchProfile(session.user.id);
      if (fresh) setProfile(fresh);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.ratings}>
            <View style={styles.ratingBlock}>
              <ThemedText type="title" style={styles.rating}>
                {profile?.casual_rating ?? '—'}
              </ThemedText>
              <ThemedText type="small">Casual</ThemedText>
              {profile && profile.casual_games < 8 && (
                <ThemedText type="small" style={{ color: theme.accent }}>
                  Provisional · {profile.casual_games}/8
                </ThemedText>
              )}
            </View>

            <View style={styles.ratingBlock}>
              <ThemedText type="title" style={styles.rating}>
                {profile?.sanctioned_rating ?? '—'}
              </ThemedText>
              <ThemedText type="small">Sanctioned</ThemedText>
              {profile && profile.sanctioned_games === 0 && (
                <ThemedText type="small">No events yet</ThemedText>
              )}
            </View>
          </View>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="subtitle">Setup</ThemedText>

            <ThemedText type="default">Blade</ThemedText>
            <TextInput
              value={profile?.blade ?? ''}
              onChangeText={(v) => patch('blade', v)}
              placeholder="e.g. Butterfly Vispendia"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { borderColor: theme.textSecondary }]}
            />

            <ThemedText type="default">Forehand rubber</ThemedText>
            <TextInput
              value={profile?.fh_rubber ?? ''}
              onChangeText={(v) => patch('fh_rubber', v)}
              placeholder="e.g. Tenergy 19"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { borderColor: theme.textSecondary }]}
            />

            <ThemedText type="default">Backhand rubber</ThemedText>
            <TextInput
              value={profile?.bh_rubber ?? ''}
              onChangeText={(v) => patch('bh_rubber', v)}
              placeholder="e.g. Drax"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { borderColor: theme.textSecondary }]}
            />

            <ThemedText type="default">Grip</ThemedText>
            <View style={styles.row}>
              {GRIPS.map((g) => (
                <ThemedView
                  key={g}
                  type={profile?.grip === g ? 'backgroundSelected' : 'background'}
                  style={styles.chip}
                  onTouchEnd={() => patch('grip', g)}>
                  <ThemedText type="small">{g}</ThemedText>
                </ThemedView>
              ))}
            </View>

            <ThemedText type="default">Home city</ThemedText>
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder="Kuala Lumpur"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { borderColor: theme.textSecondary }]}
            />

            {/* Leave every slot off to mean "any time". Hiding a player who
                never set this would make them unfindable, not honest. */}
            <ThemedText type="default">Available to play</ThemedText>
            <ThemedText type="small">
              Leave all off to be listed as available at any time.
            </ThemedText>
            <View style={styles.row}>
              {AVAILABILITY_SLOTS.map((slot) => {
                const on = (profile?.availability ?? []).includes(slot.value);
                return (
                  <ThemedView
                    key={slot.value}
                    type={on ? 'backgroundSelected' : 'background'}
                    style={styles.chip}
                    onTouchEnd={() => toggleSlot(slot.value)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={slot.label}>
                    <ThemedText type="small">{slot.label}</ThemedText>
                  </ThemedView>
                );
              })}
            </View>

            <ThemedText type="default">Show my rating to others</ThemedText>
            <View style={styles.row}>
              <ThemedView
                type={profile?.rating_visible ? 'backgroundSelected' : 'background'}
                style={styles.chip}
                onTouchEnd={() => patch('rating_visible', true)}
                accessibilityRole="radio"
                accessibilityState={{ checked: profile?.rating_visible === true }}>
                <ThemedText type="small">Visible</ThemedText>
              </ThemedView>
              <ThemedView
                type={profile?.rating_visible ? 'background' : 'backgroundSelected'}
                style={styles.chip}
                onTouchEnd={() => patch('rating_visible', false)}
                accessibilityRole="radio"
                accessibilityState={{ checked: profile?.rating_visible === false }}>
                <ThemedText type="small">Private</ThemedText>
              </ThemedView>
            </View>
          </ThemedView>

          <ThemedView
            type="backgroundSelected"
            style={styles.saveButton}
            onTouchEnd={save}
            accessibilityRole="button"
            accessibilityLabel="Save profile">
            <ThemedText type="default">{saving ? 'Saving…' : 'Save'}</ThemedText>
          </ThemedView>
          {saved && <ThemedText type="small">Saved</ThemedText>}
          {error && (
            <ThemedText type="small" style={{ color: theme.negative }}>
              {error}
            </ThemedText>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  scroll: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  ratings: { flexDirection: 'row', justifyContent: 'space-around' },
  ratingBlock: { alignItems: 'center', gap: Spacing.one },
  rating: { fontSize: 56, fontVariant: ['tabular-nums'] },
  card: { padding: Spacing.three, gap: Spacing.two, borderRadius: Spacing.four },
  input: { borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  saveButton: { padding: Spacing.three, borderRadius: Spacing.two, alignItems: 'center' },
});
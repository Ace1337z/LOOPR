import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useOrganiserAccess } from '@/hooks/use-organiser-access';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { redeemInvite } from '@/lib/db';
import { supabase } from '@/lib/supabase';

export default function SignInScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const { role, isOrganiser, loading } = useOrganiserAccess(session?.user.id);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function sendMagicLink() {
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      Alert.alert('Check the email', 'Enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: 'loopr://auth' },
      });
      if (error) throw new Error(error.message);
      Alert.alert('Check your inbox', 'Magic link sent. Tap it to finish signing in.');
    } catch (e) {
      Alert.alert('Could not sign in', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const granted = await redeemInvite(code.trim());
      Alert.alert('Welcome aboard', `You now have ${granted} access.`);
      setCode('');
    } catch (e) {
      Alert.alert('Could not redeem', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.scroll}>
          <ThemedText type="title">LOOPR</ThemedText>

          {!session?.user ? (
            <>
              <ThemedText type="small">No password. We email you a link.</ThemedText>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                style={[styles.input, { borderColor: theme.textSecondary }]}
              />
              <Pressable onPress={sendMagicLink} disabled={busy} style={[styles.button, busy && { opacity: 0.5 }]}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText type="default">Send magic link</ThemedText>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <ThemedText type="small">Signed in.</ThemedText>
              {loading ? (
                <ActivityIndicator color={theme.accent} />
              ) : isOrganiser ? (
                <ThemedText type="default">
                  Role: {role} · organiser tools are on the Organiser tab.
                </ThemedText>
              ) : (
                <>
                  <ThemedText type="small">
                    Have an invite code from a tournament organiser? Redeem it here.
                  </ThemedText>
                  <TextInput
                    value={code}
                    onChangeText={setCode}
                    placeholder="Invite code"
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={[styles.input, { borderColor: theme.textSecondary }]}
                  />
                  <Pressable onPress={redeem} disabled={busy} style={[styles.button, busy && { opacity: 0.5 }]}>
                    <ThemedText type="default">Redeem invite</ThemedText>
                  </Pressable>
                </>
              )}
              <Pressable onPress={signOut}>
                <ThemedText type="link">Sign out</ThemedText>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' },
  scroll: { flex: 1, padding: Spacing.four, gap: Spacing.three, justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  button: { backgroundColor: '#D9400F', borderRadius: Spacing.two, padding: Spacing.three, alignItems: 'center' },
});
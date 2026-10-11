import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { usePendingCount } from '@/hooks/use-pending-count';
import { useOrganiserAccess } from '@/hooks/use-organiser-access';
import { useSession } from '@/hooks/use-session';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  const { session } = useSession();
  const { isOrganiser, isAdmin } = useOrganiserAccess(session?.user.id);
  const pending = usePendingCount(session?.user.id);

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="partners">
        <NativeTabs.Trigger.Label>Partners</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="log-match">
        <NativeTabs.Trigger.Label>Log</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      {/* Badge so a waiting opponent is visible without opening the tab. */}
      <NativeTabs.Trigger name="confirm">
        <NativeTabs.Trigger.Label>Confirm</NativeTabs.Trigger.Label>
        {pending > 0 && <NativeTabs.Trigger.Badge>{String(pending)}</NativeTabs.Trigger.Badge>}
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      {/* Only rendered for staff, so players never see a tab they cannot use.
          The database re-checks every write regardless. */}
      {isOrganiser && (
        <NativeTabs.Trigger name="admin">
          <NativeTabs.Trigger.Label>{isAdmin ? 'Admin' : 'Organise'}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      )}

      <NativeTabs.Trigger name="auth">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
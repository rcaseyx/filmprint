import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { Colors } from '@/constants/theme'

export default function AppLayout() {
  return (
    <NativeTabs backgroundColor={Colors.background}>
      <NativeTabs.Trigger name="picks">
        <NativeTabs.Trigger.Label>Picks</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}

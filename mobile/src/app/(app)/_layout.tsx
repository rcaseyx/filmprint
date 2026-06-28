import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { Colors } from '@/constants/theme'

// On iOS 26, expo-router always passes a non-nil UITabBarAppearance to each
// Tabs.Screen. Any non-nil appearance prevents iOS 26 from applying liquid
// glass automatically. We override standardAppearance and scrollEdgeAppearance
// to undefined on each trigger so the native component receives nil and iOS 26
// can apply its default glass treatment.
const noAppearance = { ios: { standardAppearance: undefined, scrollEdgeAppearance: undefined } } as const

export default function AppLayout() {
  return (
    <NativeTabs
      tintColor={Colors.brand}
      minimizeBehavior="never"
    >
      <NativeTabs.Trigger name="picks" unstable_nativeProps={noAppearance}>
        <NativeTabs.Trigger.Label>Picks</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'film', selected: 'film.fill' }}
          src={require('@/assets/images/tabIcons/home.png')}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" unstable_nativeProps={noAppearance}>
        <NativeTabs.Trigger.Label>People</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.2', selected: 'person.2.fill' }}
          src={require('@/assets/images/tabIcons/explore.png')}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile" unstable_nativeProps={noAppearance}>
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
          src={require('@/assets/images/tabIcons/explore.png')}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}

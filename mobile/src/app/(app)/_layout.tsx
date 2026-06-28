import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { Colors } from '@/constants/theme'

// Per-item nil appearance: expo-router always passes a non-nil UITabBarAppearance
// to each Tabs.Screen, which suppresses iOS 26 liquid glass. Passing undefined
// here lets our patch-package patch gate it to nil in native code.
const noAppearance = { ios: { standardAppearance: undefined, scrollEdgeAppearance: undefined } } as const

// UITabBarController.view.backgroundColor defaults to systemBackgroundColor
// (pure black in dark mode). On iOS 26 the floating glass tab bar doesn't
// fully cover this area, so it bleeds through as a black bar. Setting it to
// the app background color makes the gap invisible whether or not glass applies.
const hostProps = {
  nativeContainerStyle: { backgroundColor: Colors.background },
} as any

export default function AppLayout() {
  return (
    <NativeTabs
      tintColor={Colors.brand}
      minimizeBehavior="never"
      unstable_nativeProps={hostProps}
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

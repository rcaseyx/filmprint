import { ThemeProvider, DarkTheme } from 'expo-router'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { Colors } from '@/constants/theme'

// expo-router computes a non-nil UITabBarAppearance for each tab item, which
// suppresses iOS 26 liquid glass. Passing undefined routes through our
// patch-package patch to set _standardAppearance = nil in native code, letting
// UIKit apply glass automatically.
const noAppearance = { ios: { standardAppearance: undefined, scrollEdgeAppearance: undefined } } as const

// Safety net: matches UITabBarController.view.backgroundColor to the app
// background so the container is invisible when glass is off (e.g. reduce
// transparency enabled).
const hostProps = { nativeContainerStyle: { backgroundColor: Colors.background } } as any

export default function AppLayout() {
  return (
    <ThemeProvider value={DarkTheme}>
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
        <NativeTabs.Trigger name="games" unstable_nativeProps={noAppearance}>
          <NativeTabs.Trigger.Label>Games</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: 'gamecontroller', selected: 'gamecontroller.fill' }}
            src={require('@/assets/images/tabIcons/explore.png')}
          />
        </NativeTabs.Trigger>
      </NativeTabs>
    </ThemeProvider>
  )
}

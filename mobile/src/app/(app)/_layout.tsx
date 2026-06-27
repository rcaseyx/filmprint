import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { Colors } from '@/constants/theme'

export default function AppLayout() {
  return (
    <NativeTabs
      blurEffect="systemChromeMaterialDark"
      disableTransparentOnScrollEdge
      minimizeBehavior="never"
      iconColor={{ default: Colors.textMuted, selected: Colors.brand }}
      labelStyle={{
        default: { color: Colors.textMuted, fontSize: 11 },
        selected: { color: Colors.brand, fontSize: 11 },
      }}
      shadowColor={Colors.border}
    >
      <NativeTabs.Trigger name="picks">
        <NativeTabs.Trigger.Label>Picks</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'film', selected: 'film.fill' }}
          src={require('@/assets/images/tabIcons/home.png')}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search">
        <NativeTabs.Trigger.Label>People</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.2', selected: 'person.2.fill' }}
          src={require('@/assets/images/tabIcons/explore.png')}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
          src={require('@/assets/images/tabIcons/explore.png')}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}

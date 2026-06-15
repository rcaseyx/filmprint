import { View } from 'react-native'
import { Stack } from 'expo-router'
import { Colors } from '@/constants/theme'

export default function PicksLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }} />
    </View>
  )
}

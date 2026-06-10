import { Redirect } from 'expo-router'
import { View } from 'react-native'
import { useAuth } from '@/lib/auth'
import { Colors } from '@/constants/theme'

export default function Index() {
  const { token, isLoading } = useAuth()
  if (isLoading) return <View style={{ flex: 1, backgroundColor: Colors.background }} />
  return <Redirect href={token ? '/picks' : '/login'} />
}

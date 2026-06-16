import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { Colors, Spacing } from '@/constants/theme'
import { Avatar } from '@/components/Avatar'
import { useDebounce } from '@/lib/useDebounce'
import { apiFetch } from '@/lib/api'
import { getPendingProfile, clearPendingProfile } from '@/lib/pendingNavigation'

interface UserResult {
  id: number
  letterboxd_username: string | null
  display_name: string | null
  ratings_count: number
}

export default function PeopleScreen() {
  const router = useRouter()

  useFocusEffect(useCallback(() => {
    const pending = getPendingProfile()
    if (pending) {
      clearPendingProfile()
      router.push(`/search/${pending}`)
    }
  }, [router]))

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserResult[]>([])
  const [loading, setLoading] = useState(false)
  const debouncedQuery = useDebounce(query, 300)

  useEffect(() => {
    if (!debouncedQuery.trim()) { setResults([]); return }
    setLoading(true)
    apiFetch(`/api/users/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then(r => r.json())
      .then(data => setResults(data.users ?? []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [debouncedQuery])

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.heading}>Find a user</Text>
        <Text style={s.sub}>Search by username</Text>
      </View>

      {/* Search input */}
      <View style={s.inputWrap}>
        <TextInput
          style={s.input}
          placeholder="Username"
          placeholderTextColor={Colors.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {loading && <ActivityIndicator size="small" color={Colors.textMuted} style={s.spinner} />}
      </View>

      {/* Empty state */}
      {!loading && query.trim() && results.length === 0 && (
        <Text style={s.empty}>No filmprint users found for "{query.trim()}"</Text>
      )}

      {/* Results */}
      <FlatList
        data={results}
        keyExtractor={u => String(u.id)}
        contentContainerStyle={s.list}
        style={{ opacity: loading ? 0.4 : 1 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: user }) => {
          const name = user.letterboxd_username ?? user.display_name ?? 'Unknown'
          const tappable = !!user.letterboxd_username
          const inner = (
            <View style={s.row}>
              <Avatar name={name} size={38} />
              <View style={s.rowText}>
                <Text style={s.rowName}>{name}</Text>
                <Text style={s.rowCount}>{user.ratings_count} ratings</Text>
              </View>
            </View>
          )
          return tappable ? (
            <TouchableOpacity
              style={s.item}
              activeOpacity={0.7}
              onPress={() => router.push(`/search/${user.letterboxd_username}`)}
            >
              {inner}
            </TouchableOpacity>
          ) : (
            <View style={s.item}>{inner}</View>
          )
        }}
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.sm, gap: 3 },
  heading: { fontSize: 24, fontWeight: '600', color: Colors.text, letterSpacing: -0.3 },
  sub: { fontSize: 13, color: Colors.textMuted },
  inputWrap: { marginHorizontal: Spacing.lg, marginBottom: Spacing.sm, position: 'relative' },
  input: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: Colors.text,
  },
  spinner: { position: 'absolute', right: 12, top: 12 },
  empty: { fontSize: 14, color: Colors.textMuted, paddingHorizontal: Spacing.lg, marginTop: Spacing.sm },
  list: { paddingHorizontal: Spacing.sm, paddingBottom: 100 },
  item: { paddingHorizontal: Spacing.sm, paddingVertical: 10, borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { gap: 2 },
  rowName: { fontSize: 14, fontWeight: '500', color: Colors.text },
  rowCount: { fontSize: 12, color: Colors.textMuted },
})

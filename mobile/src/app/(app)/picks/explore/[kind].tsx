import { useCallback, useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { getDirectorSuggestion, getBlindSpotSuggestion, getMoreByDirector, type Pick } from '@/lib/api'
import { FilmCard } from '@/components/FilmCard'

type Kind = 'director' | 'blindspot'
type Status = 'loading' | 'suggestion' | 'empty' | 'error'

const EMPTY_COPY: Record<Kind, string> = {
  director: "You've explored deeply — no new directors to suggest right now.",
  blindspot: 'Rate a few more films to unlock this.',
}

const LOADING_COPY: Record<Kind, string> = {
  director: 'Finding directors you may not know...',
  blindspot: 'Revealing your blind spots...',
}

export default function ExploreResultScreen() {
  const router = useRouter()
  const { bottom: bottomInset } = useSafeAreaInsets()
  const { kind: rawKind } = useLocalSearchParams<{ kind: string }>()
  const kind: Kind = rawKind === 'blindspot' ? 'blindspot' : 'director'

  const [status, setStatus] = useState<Status>('loading')
  const [suggestion, setSuggestion] = useState<Pick | null>(null)
  const [loadingLabel, setLoadingLabel] = useState(LOADING_COPY[kind])
  const [moreExhausted, setMoreExhausted] = useState(false)

  const fetchSuggestion = useCallback(async () => {
    setLoadingLabel(LOADING_COPY[kind])
    setStatus('loading')
    setMoreExhausted(false)
    try {
      const result = kind === 'director' ? await getDirectorSuggestion() : await getBlindSpotSuggestion()
      if (!result) { setStatus('empty'); return }
      setSuggestion(result)
      setStatus('suggestion')
    } catch {
      setStatus('error')
    }
  }, [kind])

  useEffect(() => { fetchSuggestion() }, [fetchSuggestion])

  const fetchMoreByDirector = async () => {
    if (!suggestion?.director) return
    const director = suggestion.director
    const excludeId = suggestion.id
    setLoadingLabel(`Finding another film by ${director}...`)
    setStatus('loading')
    try {
      const result = await getMoreByDirector(director, excludeId)
      if (!result) {
        setMoreExhausted(true)
        setStatus('suggestion')
        return
      }
      setSuggestion(result)
      setStatus('suggestion')
    } catch {
      // fetch failed — fall back to showing the previous suggestion rather than an error state
      setStatus('suggestion')
    }
  }

  const badgeOverride = suggestion
    ? (kind === 'director' ? `Director: ${suggestion.director}` : `Blind spot: ${suggestion.gap_label}`)
    : undefined

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <TouchableOpacity style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color={Colors.textSecondary} />
        <Text style={s.backText}>Picks</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: bottomInset + 56 }]}
        showsVerticalScrollIndicator={false}
      >
        {status === 'loading' && (
          <View style={s.center}>
            <ActivityIndicator color={Colors.brand} />
            <Text style={s.centerText}>{loadingLabel}</Text>
          </View>
        )}

        {status === 'suggestion' && suggestion && (
          <>
            <FilmCard pick={suggestion} badgeOverride={badgeOverride} />
            <TouchableOpacity style={s.btnPrimary} activeOpacity={0.85} onPress={fetchSuggestion}>
              <Text style={s.btnPrimaryText}>{kind === 'director' ? 'Find another director' : 'Show another'}</Text>
            </TouchableOpacity>
            {kind === 'director' && suggestion.director && (
              <TouchableOpacity
                style={s.btnSecondary}
                activeOpacity={0.85}
                disabled={moreExhausted}
                onPress={fetchMoreByDirector}
              >
                <Text style={[s.btnSecondaryText, moreExhausted && s.btnSecondaryTextDisabled]}>
                  {moreExhausted ? `No more films by ${suggestion.director}` : `Another film by ${suggestion.director}`}
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {status === 'empty' && (
          <View style={s.center}>
            <Text style={s.centerText}>{EMPTY_COPY[kind]}</Text>
          </View>
        )}

        {status === 'error' && (
          <View style={s.center}>
            <Text style={[s.centerText, { color: Colors.error }]}>Something went wrong — try again.</Text>
            <TouchableOpacity style={s.btnSecondary} activeOpacity={0.85} onPress={fetchSuggestion}>
              <Text style={s.btnSecondaryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  backText: { fontSize: 15, color: Colors.textSecondary },
  scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.md },
  center: { alignItems: 'center', gap: 14, paddingVertical: 40 },
  centerText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
  btnPrimary: { backgroundColor: Colors.brand, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  btnPrimaryText: { fontSize: 15, fontWeight: '700', color: '#0a0a0a' },
  btnSecondary: { borderRadius: 16, borderWidth: 1, borderColor: Colors.border, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  btnSecondaryText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  btnSecondaryTextDisabled: { color: Colors.textFaint },
})

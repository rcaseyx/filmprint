import { useState, useEffect } from 'react'
import { View, Text, Pressable, Image, ActivityIndicator, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'

const TMDB_IMG = 'https://image.tmdb.org/t/p/w185'

// Same NativeTabs bottom-bar clearance fix as six-degrees.tsx/trifecta.tsx.
const TAB_BAR_CLEARANCE = 56

interface Question {
  id: number
  source: string
  question_type: string
  question_text: string
  options: string[]
  image_url: string | null
}

interface AnswerResult {
  correct: boolean
  correct_answer: string
}

export default function TriviaScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [result, setResult] = useState<AnswerResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [score, setScore] = useState(0)

  async function loadSession() {
    setLoading(true)
    setError(false)
    setIndex(0)
    setSelected(null)
    setResult(null)
    setScore(0)
    try {
      const res = await apiFetch('/api/games/trivia/session')
      if (!res.ok) { setError(true); return }
      const data = await res.json()
      setQuestions(data.questions)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadSession() }, [])

  async function selectAnswer(answer: string) {
    if (result || checking) return
    setSelected(answer)
    setChecking(true)
    try {
      const res = await apiFetch('/api/games/trivia/answer', {
        method: 'POST',
        body: JSON.stringify({ question_id: questions[index].id, answer }),
      })
      if (res.ok) {
        const data: AnswerResult = await res.json()
        setResult(data)
        if (data.correct) setScore(s => s + 1)
      }
    } finally {
      setChecking(false)
    }
  }

  function next() {
    setSelected(null)
    setResult(null)
    setIndex(i => i + 1)
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} />
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.textMuted} />
      </SafeAreaView>
    )
  }

  if (error || questions.length === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} />
        <Text style={s.empty}>Couldn&rsquo;t load trivia — try refreshing.</Text>
      </SafeAreaView>
    )
  }

  const done = index >= questions.length

  if (done) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <BackBar router={router} />
        <View style={s.doneWrap}>
          <Text style={s.heading}>Session complete!</Text>
          <Text style={s.scoreText}>{score} / {questions.length}</Text>
          <Pressable style={s.playAgainBtn} onPress={loadSession}>
            <Text style={s.playAgainText}>Play again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  const q = questions[index]

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <BackBar router={router} />
        <Text style={s.progress}>{index + 1} / {questions.length}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }}>
        <Text style={s.heading}>Trivia</Text>

        {q.image_url && (
          <View style={s.imageWrap}>
            <Image source={{ uri: `${TMDB_IMG}${q.image_url}` }} style={s.image} />
          </View>
        )}

        <Text style={s.question}>{q.question_text}</Text>

        <View style={s.options}>
          {q.options.map(opt => {
            const isSelected = selected === opt
            const isCorrect = result && opt === result.correct_answer
            const isWrong = result && isSelected && !result.correct
            return (
              <Pressable
                key={opt}
                onPress={() => selectAnswer(opt)}
                disabled={!!result || checking}
                style={[
                  s.option,
                  isCorrect && s.optionCorrect,
                  isWrong && s.optionWrong,
                  isSelected && !result && s.optionSelected,
                ]}
              >
                <Text style={s.optionText}>{opt}</Text>
              </Pressable>
            )
          })}
        </View>

        {result && (
          <Pressable style={s.nextBtn} onPress={next}>
            <Text style={s.nextBtnText}>{index + 1 < questions.length ? 'Next' : 'See results'}</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function BackBar({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <Pressable style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
      <ChevronLeft size={22} color={Colors.textSecondary} />
      <Text style={s.backText}>Games</Text>
    </Pressable>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: Spacing.lg },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  backText: { fontSize: 15, color: Colors.textSecondary },
  progress: { fontSize: 13, color: Colors.textMuted },
  empty: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginTop: 40 },
  heading: { fontSize: 20, fontWeight: '700', color: Colors.text, paddingHorizontal: Spacing.lg, marginTop: Spacing.xs },
  imageWrap: { alignItems: 'center', marginTop: Spacing.lg },
  image: { width: 120, height: 180, borderRadius: 12, backgroundColor: Colors.card },
  question: { fontSize: 17, color: Colors.text, paddingHorizontal: Spacing.lg, marginTop: Spacing.lg, lineHeight: 24 },
  options: { paddingHorizontal: Spacing.lg, marginTop: Spacing.lg, gap: Spacing.sm },
  option: {
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card,
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: Spacing.md,
  },
  optionSelected: { borderColor: Colors.brand },
  optionCorrect: { borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)' },
  optionWrong: { borderColor: Colors.error, backgroundColor: 'rgba(248,113,113,0.1)' },
  optionText: { fontSize: 15, color: Colors.text },
  nextBtn: {
    marginHorizontal: Spacing.lg, marginTop: Spacing.lg,
    backgroundColor: Colors.brand, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  nextBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  doneWrap: { alignItems: 'center', marginTop: Spacing.xl * 2, gap: Spacing.xs },
  scoreText: { fontSize: 40, fontWeight: '800', color: Colors.text, marginTop: Spacing.sm },
  playAgainBtn: {
    marginTop: Spacing.lg, backgroundColor: Colors.brand, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 32,
  },
  playAgainText: { fontSize: 15, fontWeight: '700', color: Colors.background },
})

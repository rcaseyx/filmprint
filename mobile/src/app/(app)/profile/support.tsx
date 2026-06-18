import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch } from '@/lib/api'

type Status = 'idle' | 'loading' | 'success' | 'error'

export default function SupportScreen() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [issueNumber, setIssueNumber] = useState<number | null>(null)
  const [errorDetail, setErrorDetail] = useState('')

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) return
    setStatus('loading')
    try {
      const res = await apiFetch('/api/support', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        setIssueNumber(data.number)
        setStatus('success')
      } else {
        const err = await res.json().catch(() => ({}))
        setErrorDetail(`${res.status}: ${(err as any).detail ?? 'unknown'}`)
        setStatus('error')
      }
    } catch (e: any) {
      setErrorDetail(e?.message ?? 'network error')
      setStatus('error')
    }
  }

  const reset = () => {
    setTitle(''); setDescription(''); setStatus('idle'); setIssueNumber(null)
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>

      <TouchableOpacity style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color={Colors.textSecondary} />
        <Text style={s.backText}>Profile</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {status === 'success' ? (
          <View style={s.successWrap}>
            <Text style={s.heading}>Report filed — thanks.</Text>
            <Text style={s.sub}>Tracked as issue #{issueNumber}. We'll look into it.</Text>
            <TouchableOpacity onPress={reset} style={s.anotherBtn} activeOpacity={0.7}>
              <Text style={s.anotherText}>Submit another</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={s.headerBlock}>
              <Text style={s.heading}>Report a bug</Text>
              <Text style={s.sub}>Something broken or off? Let us know and we'll look into it.</Text>
            </View>

            <View style={s.form}>
              <View style={s.field}>
                <Text style={s.label}>Title</Text>
                <TextInput
                  style={s.input}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Short summary of the issue"
                  placeholderTextColor={Colors.textFaint}
                  autoCapitalize="sentences"
                  returnKeyType="next"
                  editable={status !== 'loading'}
                />
              </View>

              <View style={s.field}>
                <Text style={s.label}>Description</Text>
                <TextInput
                  style={[s.input, s.textArea]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="What happened? What did you expect?"
                  placeholderTextColor={Colors.textFaint}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                  editable={status !== 'loading'}
                />
              </View>

              {status === 'error' && (
                <Text style={s.errorText}>Something went wrong — try again.{errorDetail ? `\n${errorDetail}` : ''}</Text>
              )}

              <TouchableOpacity
                style={[s.submitBtn, (!title.trim() || !description.trim() || status === 'loading') && s.submitBtnDisabled]}
                onPress={handleSubmit}
                activeOpacity={0.8}
                disabled={!title.trim() || !description.trim() || status === 'loading'}
              >
                {status === 'loading'
                  ? <ActivityIndicator size="small" color="#0a0a0a" />
                  : <Text style={s.submitText}>Submit report</Text>
                }
              </TouchableOpacity>

              <TouchableOpacity onPress={() => Linking.openURL('https://myfilmprint.com/privacy')} activeOpacity={0.7}>
                <Text style={s.privacyLink}>Privacy Policy</Text>
              </TouchableOpacity>
            </View>

          </>
        )}

      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  backText: { fontSize: 15, color: Colors.textSecondary },
  scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: 60, gap: 24 },
  headerBlock: { gap: 4 },
  heading: { fontSize: 22, fontWeight: '600', color: Colors.text, letterSpacing: -0.2 },
  sub: { fontSize: 14, color: Colors.textMuted, lineHeight: 20 },
  form: { gap: 18 },
  field: { gap: 6 },
  label: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  input: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: Colors.text,
  },
  textArea: { minHeight: 130, paddingTop: 12 },
  errorText: { fontSize: 13, color: Colors.error },
  submitBtn: {
    alignSelf: 'flex-start', backgroundColor: Colors.brand,
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20,
    minWidth: 140, alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitText: { fontSize: 15, fontWeight: '700', color: '#0a0a0a' },
  successWrap: { gap: 8 },
  anotherBtn: { marginTop: 12 },
  anotherText: { fontSize: 14, color: Colors.textMuted },
  privacyLink: { fontSize: 13, color: Colors.textFaint },
})

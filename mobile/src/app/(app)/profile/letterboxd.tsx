import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as DocumentPicker from 'expo-document-picker'
import { Colors, Spacing } from '@/constants/theme'
import { apiFetch, TOKEN_KEY } from '@/lib/api'
import * as SecureStore from 'expo-secure-store'

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000'

export default function ProfileLetterboxdScreen() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'application/zip', 'application/octet-stream'],
      copyToCacheDirectory: true,
    })
    if (!result.canceled && result.assets[0]) {
      setFile(result.assets[0])
    }
  }

  const connect = async () => {
    const trimmed = username.trim()
    if (!trimmed) {
      setError('Enter your Letterboxd username')
      return
    }
    setError('')
    setSubmitting(true)

    try {
      if (file) {
        const token = await SecureStore.getItemAsync(TOKEN_KEY)
        const form = new FormData()
        form.append('file', {
          uri: file.uri,
          name: file.name,
          type: file.mimeType ?? 'application/octet-stream',
        } as any)
        form.append('username', trimmed)

        const res = await fetch(`${API_URL}/api/import`, {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: form,
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.detail ?? 'Import failed')
        }
      } else {
        const res = await apiFetch('/api/settings/letterboxd', {
          method: 'POST',
          body: JSON.stringify({ username: trimmed }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.detail ?? 'Could not connect Letterboxd')
        }
      }

      router.back()
    } catch (e: any) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  if (submitting) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.brand} />
          <Text style={s.syncLabel}>Connecting your account…</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>

        <View style={s.header}>
          <Text style={s.heading}>Connect Letterboxd</Text>
          <Text style={s.body}>
            Enter your username to keep your ratings in sync. You can also upload a Letterboxd export for a more complete history.
          </Text>
        </View>

        <View style={s.form}>
          <Text style={s.fieldLabel}>Username</Text>
          <TextInput
            style={s.input}
            placeholder="e.g. letterboxd_username"
            placeholderTextColor={Colors.textFaint}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />

          <Text style={s.fieldLabel}>Export file <Text style={s.optional}>(optional)</Text></Text>
          <TouchableOpacity style={s.uploadBtn} onPress={pickFile} activeOpacity={0.85}>
            <Text style={[s.uploadText, !!file && s.uploadTextSelected]}>
              {file ? `✓  ${file.name}` : 'Choose file (.zip or .csv)'}
            </Text>
          </TouchableOpacity>
          <Text style={s.uploadHint}>
            letterboxd.com → Settings → Import &amp; Export → Export your data
          </Text>

          {!!error && <Text style={s.error}>{error}</Text>}

          <TouchableOpacity
            style={[s.connectBtn, !username.trim() && s.disabled]}
            onPress={connect}
            disabled={!username.trim()}
            activeOpacity={0.85}
          >
            <Text style={s.connectText}>Connect</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flexGrow: 1, padding: Spacing.lg, gap: Spacing.lg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.md },
  backBtn: { alignSelf: 'flex-start' },
  back: { fontSize: 14, color: Colors.textMuted },
  header: { gap: Spacing.xs },
  heading: { fontSize: 24, fontWeight: '700', color: Colors.text },
  body: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  form: { gap: Spacing.sm },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  optional: { fontWeight: '400', color: Colors.textMuted },
  input: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: 13,
    fontSize: 14,
    color: Colors.text,
  },
  uploadBtn: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  uploadText: { fontSize: 14, color: Colors.textMuted },
  uploadTextSelected: { color: Colors.brand },
  uploadHint: { fontSize: 12, color: Colors.textMuted, lineHeight: 18 },
  connectBtn: {
    backgroundColor: Colors.brand,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  connectText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  disabled: { opacity: 0.4 },
  error: { fontSize: 12, color: Colors.error },
  syncLabel: { fontSize: 16, fontWeight: '600', color: Colors.text },
})

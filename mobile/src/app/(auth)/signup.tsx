import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { Link, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { apiFetch } from '@/lib/api'
import { Colors, Spacing } from '@/constants/theme'

const passwordValid = (p: string) => p.length >= 8 && /\d/.test(p)

export default function SignupScreen() {
  const { login } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const showPasswordHint = passwordTouched && !passwordValid(password)

  const handleSubmit = async () => {
    if (!passwordValid(password)) return
    if (password !== confirm) { setError("Passwords don't match"); return }
    setError('')
    setLoading(true)
    try {
      const registerRes = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      if (!registerRes.ok) {
        const data = await registerRes.json().catch(() => ({}))
        setError(data.detail || 'Something went wrong')
        return
      }
      const verifyRes = await apiFetch('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      if (!verifyRes.ok) { setError('Account created — please sign in'); router.replace('/login'); return }
      const data = await verifyRes.json()
      await login(data.token)
      router.replace('/picks')
    } catch {
      setError('Could not reach the server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.flex}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <Text style={s.title}>Create account</Text>
            <Text style={s.subtitle}>filmprint</Text>
          </View>

          <View style={s.form}>
            <TextInput
              style={s.input}
              placeholder="Email"
              placeholderTextColor={Colors.textFaint}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
            />
            <View>
              <TextInput
                style={s.input}
                placeholder="Password"
                placeholderTextColor={Colors.textFaint}
                value={password}
                onChangeText={setPassword}
                onBlur={() => setPasswordTouched(true)}
                secureTextEntry
                autoComplete="new-password"
                returnKeyType="next"
              />
              {showPasswordHint && (
                <Text style={s.hint}>At least 8 characters including a number</Text>
              )}
            </View>
            <TextInput
              style={s.input}
              placeholder="Confirm password"
              placeholderTextColor={Colors.textFaint}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              autoComplete="new-password"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />

            {!!error && <Text style={s.error}>{error}</Text>}

            <TouchableOpacity
              style={[s.button, loading && s.buttonDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading
                ? <ActivityIndicator size="small" color={Colors.background} />
                : <Text style={s.buttonText}>Create account</Text>}
            </TouchableOpacity>
          </View>

          <View style={s.footer}>
            <Text style={s.footerText}>Already have an account? </Text>
            <Link href="/login" asChild>
              <TouchableOpacity>
                <Text style={s.footerLink}>Sign in</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg, gap: Spacing.xl },
  header: { alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: 24, fontWeight: '700', color: Colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: Colors.textSecondary },
  form: { gap: 12 },
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
  hint: { fontSize: 12, color: Colors.error, marginTop: 4, paddingHorizontal: 4 },
  error: { fontSize: 12, color: Colors.error },
  button: {
    backgroundColor: Colors.brand,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 14, fontWeight: '600', color: Colors.background },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { fontSize: 12, color: Colors.textMuted },
  footerLink: { fontSize: 12, color: Colors.textSecondary },
})

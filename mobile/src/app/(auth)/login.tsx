import { useState, useEffect } from 'react'
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
import * as Google from 'expo-auth-session/providers/google'
import { useAuth } from '@/lib/auth'
import { apiFetch } from '@/lib/api'
import { Colors, Spacing } from '@/constants/theme'
import { PrintLogo } from '@/components/PrintLogo'
import { FilmprintText } from '@/components/FilmprintText'

const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID

export default function LoginScreen() {
  const { login } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: IOS_CLIENT_ID,
  })

  useEffect(() => {
    if (response?.type !== 'success') return
    const idToken = response.params.id_token
    if (!idToken) {
      setError('Google sign-in failed — no token returned')
      return
    }
    setGoogleLoading(true)
    apiFetch('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken }),
    })
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          throw new Error(d.detail ?? 'Google sign-in failed')
        }
        return r.json()
      })
      .then(data => login(data.token).then(() => router.replace('/picks')))
      .catch(e => setError(e.message))
      .finally(() => setGoogleLoading(false))
  }, [response])

  const handleSubmit = async () => {
    if (!email.trim() || !password) return
    setError('')
    setLoading(true)
    try {
      const res = await apiFetch('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      if (!res.ok) {
        setError('Invalid email or password')
        return
      }
      const data = await res.json()
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
            <PrintLogo size={120} />
            <FilmprintText width={220} />
            <Text style={s.subtitle}>Personalized picks from your taste</Text>
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
            <TextInput
              style={s.input}
              placeholder="Password"
              placeholderTextColor={Colors.textFaint}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
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
                : <Text style={s.buttonText}>Sign in</Text>}
            </TouchableOpacity>

            <Link href="/forgot-password" asChild>
              <TouchableOpacity style={s.center}>
                <Text style={s.link}>Forgot password?</Text>
              </TouchableOpacity>
            </Link>
          </View>

          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>or</Text>
            <View style={s.dividerLine} />
          </View>

          <TouchableOpacity
            style={[s.googleButton, googleLoading && s.buttonDisabled]}
            onPress={() => { setError(''); promptAsync() }}
            disabled={!request || googleLoading}
            activeOpacity={0.8}
          >
            {googleLoading ? (
              <ActivityIndicator size="small" color="#1a1a1a" />
            ) : (
              <>
                <GoogleIcon />
                <Text style={s.googleButtonText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={s.footer}>
            <Text style={s.footerText}>Don't have an account? </Text>
            <Link href="/signup" asChild>
              <TouchableOpacity>
                <Text style={s.footerLink}>Sign up</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function GoogleIcon() {
  return (
    <Text style={s.googleIcon}>G</Text>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg, gap: Spacing.xl },
  header: { alignItems: 'center', gap: Spacing.sm },
  subtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
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
  center: { alignItems: 'center' },
  link: { fontSize: 12, color: Colors.textMuted },
  divider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: 12, color: Colors.textMuted },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingVertical: 13,
  },
  googleButtonText: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  googleIcon: { fontSize: 15, fontWeight: '700', color: '#4285F4' },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { fontSize: 12, color: Colors.textMuted },
  footerLink: { fontSize: 12, color: Colors.textSecondary },
})

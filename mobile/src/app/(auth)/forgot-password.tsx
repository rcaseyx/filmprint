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
import { Link } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { apiFetch } from '@/lib/api'
import { Colors, Spacing } from '@/constants/theme'

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!email.trim()) return
    setLoading(true)
    try {
      await apiFetch('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password: '' }),
      })
    } catch {
      // always show the success state — don't leak whether the email exists
    } finally {
      setLoading(false)
      setSubmitted(true)
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.flex}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <Text style={s.title}>Reset password</Text>
            {!submitted && <Text style={s.subtitle}>Enter the email you signed up with</Text>}
          </View>

          {submitted ? (
            <View style={s.success}>
              <Text style={s.successText}>
                If an account with that email exists, you'll receive a reset link shortly.
              </Text>
              <Link href="/login" asChild>
                <TouchableOpacity style={s.center}>
                  <Text style={s.link}>Back to sign in</Text>
                </TouchableOpacity>
              </Link>
            </View>
          ) : (
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
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />

              <TouchableOpacity
                style={[s.button, loading && s.buttonDisabled]}
                onPress={handleSubmit}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading
                  ? <ActivityIndicator size="small" color={Colors.background} />
                  : <Text style={s.buttonText}>Send reset link</Text>}
              </TouchableOpacity>

              <Link href="/login" asChild>
                <TouchableOpacity style={s.center}>
                  <Text style={s.link}>Back to sign in</Text>
                </TouchableOpacity>
              </Link>
            </View>
          )}
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
  success: { gap: 16, alignItems: 'center' },
  successText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
})

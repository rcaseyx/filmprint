import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import * as Google from 'expo-auth-session/providers/google'
import * as AppleAuthentication from 'expo-apple-authentication'
import { useAuth } from '@/lib/auth'
import { apiFetch } from '@/lib/api'
import { Spacing } from '@/constants/theme'

const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID

// Shared by both the login and signup screens — Google and Apple sign-in each
// transparently create an account on first use, so both screens should offer
// them, not just email/password.
export function OAuthButtons({ onError }: { onError: (message: string) => void }) {
  const { login } = useAuth()
  const router = useRouter()
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)
  const [appleAvailable, setAppleAvailable] = useState(false)

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: IOS_CLIENT_ID,
  })

  useEffect(() => {
    if (Platform.OS !== 'ios') return
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable)
  }, [])

  useEffect(() => {
    if (response?.type !== 'success') return
    const idToken = response.params.id_token
    if (!idToken) {
      onError('Google sign-in failed — no token returned')
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
      .catch(e => onError(e.message))
      .finally(() => setGoogleLoading(false))
  }, [response])

  const handleAppleSignIn = async () => {
    if (appleLoading) return
    onError('')
    setAppleLoading(true)
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      })
      if (!credential.identityToken) {
        throw new Error('Apple sign-in failed — no token returned')
      }
      // Apple only ever includes fullName on the first authorization —
      // capture it now so the backend can use it as the display name.
      const fullName = credential.fullName
        ? [credential.fullName.givenName, credential.fullName.familyName].filter(Boolean).join(' ')
        : undefined
      const res = await apiFetch('/api/auth/apple', {
        method: 'POST',
        body: JSON.stringify({ identity_token: credential.identityToken, full_name: fullName || undefined }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail ?? 'Apple sign-in failed')
      }
      const data = await res.json()
      await login(data.token)
      router.replace('/picks')
    } catch (e: any) {
      if (e?.code !== 'ERR_REQUEST_CANCELED') {
        onError(e.message ?? 'Apple sign-in failed')
      }
    } finally {
      setAppleLoading(false)
    }
  }

  return (
    <View style={s.oauthGroup}>
      {appleAvailable && (
        <View style={appleLoading && s.buttonDisabled}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={10}
            style={s.appleButton}
            onPress={handleAppleSignIn}
          />
        </View>
      )}

      <TouchableOpacity
        style={[s.googleButton, googleLoading && s.buttonDisabled]}
        onPress={() => { onError(''); promptAsync() }}
        disabled={!request || googleLoading}
        activeOpacity={0.8}
      >
        {googleLoading ? (
          <ActivityIndicator size="small" color="#1a1a1a" />
        ) : (
          <>
            <Text style={s.googleIcon}>G</Text>
            <Text style={s.googleButtonText}>Continue with Google</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  oauthGroup: { gap: Spacing.sm },
  buttonDisabled: { opacity: 0.5 },
  appleButton: { width: '100%', height: 44 },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingVertical: 13,
  },
  googleButtonText: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  googleIcon: { fontSize: 17, fontWeight: '700', color: '#4285F4' },
})

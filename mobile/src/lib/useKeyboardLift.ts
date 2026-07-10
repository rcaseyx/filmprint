import { useEffect, useRef } from 'react'
import { Animated, Keyboard, Platform } from 'react-native'

// No real iPhone keyboard (even with the predictive-text bar) exceeds this in
// portrait -- clamping to it means a bad/oversized reading from the OS can
// never push the input panel further than this, regardless of the cause.
const MAX_KEYBOARD_LIFT = 400

// How close the panel should sit to the top of the keyboard once lifted.
const KEYBOARD_GAP = 8

// Tracks how far to lift a fixed-position bottom input panel (a negative
// translateY, synced to the keyboard's own show/hide animation curve/
// duration) so it clears the keyboard -- iOS only, since Android resizes the
// window natively via adjustResize and needs no manual offset. This
// intentionally avoids both KeyboardAvoidingView and
// automaticallyAdjustKeyboardInsets: both measure position through the view
// hierarchy to compute their offset, and that measurement is unreliable
// inside NativeTabs. Tracking the OS-reported keyboard height directly
// sidesteps that class of bug -- but is clamped defensively in case the
// reported height is ever wrong, since an unbounded lift is far worse
// (pushes the whole panel off-screen) than a slightly-imperfect one.
//
// restBottomPadding is the panel's own resting paddingBottom (e.g. tab-bar
// clearance). The panel only needs to lift by however much the keyboard
// EXCEEDS that padding -- lifting by the full keyboard height on top of
// padding that's already there double-counts it, leaving that same amount
// of dead space between the panel and the keyboard.
//
// Shared across game screens with a fixed bottom input panel (originally
// built for Co-Star, six-degrees.tsx) -- extracted here rather than
// triplicated once a second game needed the identical mechanism.
export function useKeyboardLift(restBottomPadding: number) {
  const lift = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (Platform.OS !== 'ios') return
    const showSub = Keyboard.addListener('keyboardWillShow', e => {
      const height = Math.min(Math.max(e.endCoordinates?.height ?? 0, 0), MAX_KEYBOARD_LIFT)
      const extraLift = Math.max(height - restBottomPadding, 0)
      Animated.timing(lift, { toValue: -(extraLift + KEYBOARD_GAP), duration: e.duration || 250, useNativeDriver: true }).start()
    })
    const hideSub = Keyboard.addListener('keyboardWillHide', e => {
      Animated.timing(lift, { toValue: 0, duration: e.duration || 250, useNativeDriver: true }).start()
    })
    return () => { showSub.remove(); hideSub.remove() }
  }, [restBottomPadding])
  return lift
}

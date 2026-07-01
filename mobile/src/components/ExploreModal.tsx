import { useEffect, useRef } from 'react'
import { Modal, View, Text, Pressable, Animated, PanResponder, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { Film, Compass } from 'lucide-react-native'
import { Colors, Spacing } from '@/constants/theme'
import { OptionCard } from '@/components/OptionCard'

export function ExploreModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter()
  const overlayAnim = useRef(new Animated.Value(0)).current
  const sheetAnim = useRef(new Animated.Value(400)).current

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(overlayAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(sheetAnim, { toValue: 0, damping: 28, stiffness: 220, useNativeDriver: true }),
      ]).start()
    }
  }, [visible])

  const closeSheet = () => {
    Animated.parallel([
      Animated.timing(overlayAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 400, duration: 200, useNativeDriver: true }),
    ]).start(() => onClose())
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 0,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) sheetAnim.setValue(dy)
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 0.5) {
          closeSheet()
        } else {
          Animated.spring(sheetAnim, { toValue: 0, damping: 28, stiffness: 220, useNativeDriver: true }).start()
        }
      },
    })
  ).current

  const choose = (kind: 'director' | 'blindspot') => {
    closeSheet()
    router.push(`/picks/explore/${kind}`)
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={closeSheet} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, s.overlayBg, { opacity: overlayAnim }]} />
      <View style={s.sheetContainer}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
        <Animated.View style={[s.sheet, { transform: [{ translateY: sheetAnim }] }]} {...panResponder.panHandlers}>
          <View style={s.dragHandle} />
          <Text style={s.title}>Hand-picked suggestions</Text>
          <View style={s.choiceRow}>
            <OptionCard
              Icon={Film} label="A director" sub="find your next favorite filmmaker"
              selected={false} onPress={() => choose('director')}
            />
            <OptionCard
              Icon={Compass} label="A blind spot" sub="taste gaps you haven't explored"
              selected={false} onPress={() => choose('blindspot')}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlayBg: { backgroundColor: 'rgba(0,0,0,0.75)' },
  sheetContainer: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: Spacing.lg, paddingBottom: 40, gap: 16,
    borderWidth: 1, borderBottomWidth: 0, borderColor: Colors.border,
  },
  dragHandle: { width: 36, height: 4, backgroundColor: Colors.border, borderRadius: 99, alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', color: Colors.text },
  choiceRow: { flexDirection: 'row', gap: 10, height: 130 },
})

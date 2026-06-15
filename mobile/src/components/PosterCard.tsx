import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import { Colors } from '@/constants/theme'

const TMDB = 'https://image.tmdb.org/t/p/w342'

export function PosterCard({
  id, title, year, poster_path, badge,
}: {
  id: number; title: string; year?: number | null
  poster_path: string | null; badge?: React.ReactNode
}) {
  const open = () => WebBrowser.openBrowserAsync(`https://letterboxd.com/tmdb/${id}/`)
  return (
    <TouchableOpacity onPress={open} activeOpacity={0.82} style={s.wrap}>
      <View style={s.imgWrap}>
        {poster_path ? (
          <Image source={{ uri: `${TMDB}${poster_path}` }} style={s.img} contentFit="cover" transition={200} />
        ) : (
          <View style={[s.img, s.noPoster]}>
            <Text style={s.noPosterText} numberOfLines={3}>{title}</Text>
          </View>
        )}
        {badge && <View style={s.badge}>{badge}</View>}
      </View>
      <Text style={s.title} numberOfLines={1}>{title}</Text>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  wrap: { width: 104, flexShrink: 0 },
  imgWrap: { width: 104, height: 156, borderRadius: 8, overflow: 'hidden', backgroundColor: Colors.border, marginBottom: 6 },
  img: { width: '100%', height: '100%' },
  noPoster: { alignItems: 'center', justifyContent: 'center', padding: 6 },
  noPosterText: { fontSize: 10, color: Colors.textFaint, textAlign: 'center' },
  badge: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(10,10,10,0.8)', paddingVertical: 4, alignItems: 'center',
  },
  title: { fontSize: 11, color: Colors.textSecondary, lineHeight: 15 },
})

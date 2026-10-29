import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import colors from '../constants/colors';
import { buildDiscoveredProduct, discoverProducts, type DiscoveryCandidate } from '../lib/catalog';

const C = colors.light;

type State =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'results'; query: string; candidates: DiscoveryCandidate[]; note: string }
  | { kind: 'error'; message: string };

/**
 * "Find it with Liv": searches the web for any brand or product, lists what it
 * found, and builds a sourced product page for the one the person picks.
 */
export function DiscoverSection({ query }: { query: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [building, setBuilding] = useState<string | null>(null);
  const [buildError, setBuildError] = useState('');
  const clean = query.trim();

  // Results belong to the query that produced them.
  useEffect(() => {
    if (state.kind === 'results' && state.query !== clean) setState({ kind: 'idle' });
  }, [clean]);

  const search = async () => {
    if (clean.length < 2 || state.kind === 'searching') return;
    setState({ kind: 'searching' });
    setBuildError('');
    try {
      const result = await discoverProducts(clean);
      setState({ kind: 'results', query: clean, candidates: result.candidates, note: result.note });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Liv couldn’t search the web right now.' });
    }
  };

  const open = async (candidate: DiscoveryCandidate) => {
    if (building) return;
    setBuilding(candidate.id);
    setBuildError('');
    try {
      const product = await buildDiscoveredProduct(candidate.id);
      router.push(`/product/${encodeURIComponent(product.id)}`);
    } catch (error) {
      setBuildError(error instanceof Error ? error.message : 'Liv couldn’t research this product.');
    } finally {
      setBuilding(null);
    }
  };

  return <View style={st.wrap}>
    <Pressable onPress={() => void search()} disabled={clean.length < 2 || state.kind === 'searching'} accessibilityRole="button" style={({ pressed }) => [st.cta, (clean.length < 2) && st.ctaDisabled, pressed && { opacity: 0.85 }]}>
      <View style={st.ctaIcon}><Feather name="globe" size={18} color={C.primary}/></View>
      <View style={{ flex: 1 }}>
        <Text style={st.ctaTitle}>{clean.length < 2 ? 'Find any brand or product with Liv' : `Find “${clean}” with Liv`}</Text>
        <Text style={st.ctaCopy}>Liv searches the web and builds a sourced product page.</Text>
      </View>
      {state.kind === 'searching' ? <ActivityIndicator color={C.primaryForeground}/> : <Feather name="arrow-right" size={18} color={C.primaryForeground}/>}
    </Pressable>

    {state.kind === 'searching' && <Text style={st.status}>Searching the web. This usually takes 15 to 30 seconds.</Text>}
    {state.kind === 'error' && <Text style={[st.status, { color: C.destructive }]}>{state.message}</Text>}

    {state.kind === 'results' && <>
      <Text style={st.heading}>{state.candidates.length ? `What Liv found for “${state.query}”` : `Liv couldn’t find “${state.query}” yet`}</Text>
      {state.candidates.length === 0 && <Text style={st.status}>{state.note || 'Try the full brand name, or add the product type (for example, “Otherland candle”).'}</Text>}
      {state.candidates.map((candidate) => <Pressable key={candidate.id} onPress={() => void open(candidate)} disabled={!!building} accessibilityRole="button" accessibilityLabel={`Build product page for ${candidate.brand} ${candidate.name}`} style={({ pressed }) => [st.row, pressed && { opacity: 0.8 }, !!building && building !== candidate.id && { opacity: 0.5 }]}>
        <View style={{ flex: 1 }}>
          <Text style={st.brand}>{candidate.brand}</Text>
          <Text style={st.name}>{candidate.name}</Text>
          <Text style={st.meta}>{[candidate.variant, candidate.size, candidate.category].filter(Boolean).join(' · ')}</Text>
          <Text style={st.meta}>{candidate.isOfficialSite ? 'From the brand’s website' : 'From a retailer listing'}</Text>
        </View>
        {building === candidate.id ? <View style={st.buildingPill}><ActivityIndicator size="small" color={C.primary}/><Text style={st.buildingText}>Researching</Text></View> : <Feather name="chevron-right" size={18} color={C.mutedForeground}/>}
      </Pressable>)}
      {!!building && <Text style={st.status}>Liv is reading the product page and checking sources. This can take up to a minute.</Text>}
      {!!buildError && <Text style={[st.status, { color: C.destructive }]}>{buildError}</Text>}
    </>}
  </View>;
}

const st = StyleSheet.create({
  wrap: { marginBottom: 18 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.primary, borderRadius: 18, padding: 14 },
  ctaDisabled: { opacity: 0.7 },
  ctaIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: C.lavender, alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: C.primaryForeground },
  ctaCopy: { fontFamily: 'Inter_400Regular', fontSize: 11, color: '#E9DDEA', marginTop: 2 },
  status: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 17, color: C.mutedForeground, marginTop: 10 },
  heading: { fontFamily: 'Manrope_700Bold', fontSize: 17, color: C.foreground, marginTop: 18, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 13, marginBottom: 9 },
  brand: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: C.taupe, marginBottom: 2 },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 19, color: C.foreground },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.mutedForeground, marginTop: 3 },
  buildingPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.lavender, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  buildingText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: C.primary },
});

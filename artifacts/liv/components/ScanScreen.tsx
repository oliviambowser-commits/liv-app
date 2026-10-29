import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import colors from '../constants/colors';
import { Button, Header, Page } from './LivScreens';
import { identifyPhoto, lookupBarcode, type PackageIdentification } from '../lib/catalog';

const C = colors.light;
type Mode = 'barcode' | 'photo';
type Outcome =
  | { kind: 'idle' }
  | { kind: 'working'; label: string }
  | { kind: 'not_found'; code: string }
  | { kind: 'error'; message: string }
  | { kind: 'identified'; result: PackageIdentification };

const MATCH_LABEL: Record<PackageIdentification['status'], string> = {
  probable: 'Probable match',
  unverified: 'Partly readable',
  unreadable: "Couldn't read the package",
};

export function ScanScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const scanLock = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(false);
  const [mode, setMode] = useState<Mode>('barcode');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [manualCode, setManualCode] = useState('');

  // Only run the camera while this tab is on screen.
  useFocusEffect(useCallback(() => {
    setFocused(true);
    scanLock.current = false;
    return () => setFocused(false);
  }, []));

  const busy = outcome.kind === 'working';

  const findBarcode = async (code: string) => {
    if (scanLock.current) return;
    scanLock.current = true;
    Keyboard.dismiss();
    setOutcome({ kind: 'working', label: 'Looking up this barcode…' });
    try {
      const match = await lookupBarcode(code);
      if (match) {
        setOutcome({ kind: 'idle' });
        router.push(`/product/${match.product.id}`);
        return; // lock is released when the user comes back to this tab
      }
      setOutcome({ kind: 'not_found', code });
    } catch (error) {
      setOutcome({ kind: 'error', message: error instanceof Error ? error.message : "Liv couldn't look up this barcode." });
    }
    scanLock.current = false;
  };

  const onBarcodeScanned = ({ data }: BarcodeScanningResult) => {
    if (outcome.kind === 'not_found' && outcome.code === data) return; // don't loop on the same miss
    void findBarcode(data);
  };

  const takePhoto = async () => {
    if (!cameraRef.current || busy) return;
    setOutcome({ kind: 'working', label: 'Reading the package…' });
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.4 });
      if (!photo?.base64) throw new Error("The photo couldn't be captured. Please try again.");
      const result = await identifyPhoto(photo.base64);
      setOutcome({ kind: 'identified', result });
    } catch (error) {
      setOutcome({ kind: 'error', message: error instanceof Error ? error.message : "Liv couldn't read this photo." });
    }
  };

  const askAbout = (result: PackageIdentification) => {
    const name = [result.brand, result.productName, result.variant, result.size].filter(Boolean).join(' ');
    router.push({ pathname: '/ask', params: { q: `What should I know about ${name}?` } });
  };

  return <Page>
    <Header title="Scan"/>
    <View style={st.intro}>
      <Text style={st.title}>{mode === 'barcode' ? 'Point at a barcode.' : 'Snap the front of the package.'}</Text>
      <Text style={st.copy}>{mode === 'barcode'
        ? 'Liv checks its catalog and open product databases for an exact match.'
        : 'Liv reads the brand and product name from the label. Photos are sent to OpenAI to read and aren’t saved by Liv.'}</Text>
    </View>

    <View style={st.segment}>
      {(['barcode', 'photo'] as Mode[]).map((value) => <Pressable key={value} onPress={() => { setMode(value); setOutcome({ kind: 'idle' }); }} accessibilityRole="button" accessibilityState={{ selected: mode === value }} style={[st.segmentItem, mode === value && st.segmentActive]}>
        <Feather name={value === 'barcode' ? 'maximize' : 'camera'} size={15} color={mode === value ? C.primaryForeground : C.primary}/>
        <Text style={[st.segmentText, mode === value && st.segmentTextActive]}>{value === 'barcode' ? 'Barcode' : 'Package photo'}</Text>
      </Pressable>)}
    </View>

    <View style={st.cameraFrame}>
      {!permission ? <View style={st.cameraPlaceholder}><ActivityIndicator color={C.primary}/></View>
        : !permission.granted ? <View style={st.cameraPlaceholder}>
          <View style={st.permissionIcon}><Feather name="camera" size={24} color={C.primary}/></View>
          <Text style={st.permissionTitle}>Liv needs your camera to scan</Text>
          <Text style={st.permissionCopy}>The camera is only used on this screen, to read barcodes and package labels.</Text>
          {permission.canAskAgain
            ? <Button title="Allow camera" onPress={() => void requestPermission()}/>
            : <Button title="Open settings" secondary onPress={() => void Linking.openSettings()}/>}
        </View>
        : focused ? <>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'upc_a', 'ean8', 'upc_e'] }}
            onBarcodeScanned={mode === 'barcode' && !busy ? onBarcodeScanned : undefined}
          />
          {mode === 'barcode' && <View pointerEvents="none" style={st.reticle}>
            <View style={[st.corner, st.tl]}/><View style={[st.corner, st.tr]}/>
            <View style={[st.corner, st.bl]}/><View style={[st.corner, st.br]}/>
          </View>}
          {outcome.kind === 'working' && <View style={st.working}><ActivityIndicator color={C.primaryForeground}/><Text style={st.workingText}>{outcome.label}</Text></View>}
        </> : <View style={st.cameraPlaceholder}/>}
    </View>

    {mode === 'photo' && permission?.granted && <View style={st.captureRow}>
      <Pressable onPress={() => void takePhoto()} disabled={busy} accessibilityRole="button" accessibilityLabel="Take a photo of the package" style={[st.shutter, busy && { opacity: 0.5 }]}><View style={st.shutterInner}/></Pressable>
    </View>}
    {Platform.OS === 'web' && mode === 'barcode' && <Text style={st.hint}>Live barcode scanning works in the Liv app on your phone. In a browser, type the digits below.</Text>}

    {outcome.kind === 'not_found' && <View style={st.card}>
      <Text style={st.cardTitle}>No match for {outcome.code} yet</Text>
      <Text style={st.cardCopy}>This barcode isn’t in Liv’s catalog or the open product databases. A photo of the package lets Liv read the brand and name instead.</Text>
      <Button title="Take a package photo" icon="camera" onPress={() => { setMode('photo'); setOutcome({ kind: 'idle' }); }}/>
    </View>}

    {outcome.kind === 'error' && <View style={st.card}>
      <View style={st.row}><Feather name="alert-circle" size={17} color={C.destructive}/><Text style={[st.cardCopy, { flex: 1, marginTop: 0 }]}>{outcome.message}</Text></View>
    </View>}

    {outcome.kind === 'identified' && <IdentifiedCard
      result={outcome.result}
      onAsk={() => askAbout(outcome.result)}
      onLookupBarcode={(code) => { scanLock.current = false; void findBarcode(code); }}
      onRetake={() => setOutcome({ kind: 'idle' })}
    />}

    <Text style={st.label}>Or type the barcode digits</Text>
    <View style={st.inputWrap}>
      <TextInput value={manualCode} onChangeText={(value) => setManualCode(value.replace(/\D/g, ''))} placeholder="e.g. 3606000537422" placeholderTextColor={C.mutedForeground} keyboardType="number-pad" maxLength={14} style={st.input} accessibilityLabel="Barcode digits"/>
      <Pressable onPress={() => { scanLock.current = false; void findBarcode(manualCode); }} disabled={manualCode.length < 8 || busy} accessibilityRole="button" style={[st.lookupBtn, (manualCode.length < 8 || busy) && { opacity: 0.5 }]}><Text style={st.lookupText}>Look up</Text></Pressable>
    </View>
  </Page>;
}

function IdentifiedCard({ result, onAsk, onLookupBarcode, onRetake }: {
  result: PackageIdentification; onAsk: () => void; onLookupBarcode: (code: string) => void; onRetake: () => void;
}) {
  const readable = result.status !== 'unreadable' && (result.brand || result.productName);
  return <View style={st.card}>
    <View style={[st.badge, result.status === 'probable' ? st.badgeSage : st.badgeTaupe]}>
      <View style={[st.badgeDot, { backgroundColor: result.status === 'probable' ? C.sage : C.taupe }]}/>
      <Text style={st.badgeText}>{MATCH_LABEL[result.status]}</Text>
    </View>
    {readable ? <>
      {!!result.brand && <Text style={st.brand}>{result.brand}</Text>}
      <Text style={st.cardTitle}>{result.productName ?? 'Product name not readable'}</Text>
      <Text style={st.meta}>{[result.variant, result.size].filter(Boolean).join(' · ') || 'Variant and size not readable'}</Text>
    </> : null}
    {!!result.notes && <Text style={st.cardCopy}>{result.notes}</Text>}
    <Text style={st.fine}>Read from the photo only. Liv hasn’t confirmed the exact formula or size yet; a barcode match confirms it.</Text>
    <View style={{ gap: 9, marginTop: 12 }}>
      {result.barcodeDigits && <Button title={`Look up barcode ${result.barcodeDigits}`} icon="maximize" onPress={() => onLookupBarcode(result.barcodeDigits!)}/>}
      {readable && <Button title="Ask Liv about this" icon="message-square" secondary={!!result.barcodeDigits} onPress={onAsk}/>}
      <Button title="Retake photo" secondary onPress={onRetake}/>
    </View>
  </View>;
}

const CORNER = 26;
const st = StyleSheet.create({
  intro: { marginTop: 4, marginBottom: 16 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 27, lineHeight: 34, letterSpacing: -0.8, color: C.foreground },
  copy: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20, color: C.mutedForeground, marginTop: 7 },
  segment: { flexDirection: 'row', backgroundColor: C.lavender, borderRadius: 16, padding: 4, gap: 4, marginBottom: 14 },
  segmentItem: { flex: 1, minHeight: 40, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  segmentActive: { backgroundColor: C.primary },
  segmentText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.primary },
  segmentTextActive: { color: C.primaryForeground },
  cameraFrame: { height: 340, borderRadius: 24, overflow: 'hidden', backgroundColor: C.foreground },
  cameraPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 24 },
  permissionIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: C.lavender, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  permissionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 17, color: C.foreground, textAlign: 'center' },
  permissionCopy: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, color: C.mutedForeground, textAlign: 'center', marginTop: 6, marginBottom: 16, maxWidth: 260 },
  reticle: { position: 'absolute', left: '12%', right: '12%', top: '30%', bottom: '30%' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: C.gold },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
  working: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, backgroundColor: 'rgba(91,45,86,0.88)' },
  workingText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.primaryForeground },
  captureRow: { alignItems: 'center', marginTop: 16 },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: C.primary },
  hint: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, color: C.mutedForeground, marginTop: 10 },
  card: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 16, marginTop: 16 },
  cardTitle: { fontFamily: 'Manrope_700Bold', fontSize: 17, lineHeight: 23, color: C.foreground },
  cardCopy: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, color: C.mutedForeground, marginTop: 8, marginBottom: 4 },
  brand: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: C.taupe, marginBottom: 3 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.mutedForeground, marginTop: 3 },
  fine: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 15, color: C.mutedForeground, marginTop: 8 },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 10, minHeight: 25, marginBottom: 10 },
  badgeSage: { backgroundColor: '#E4EDE5' },
  badgeTaupe: { backgroundColor: '#F0EAE0' },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: C.foreground },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.foreground, marginTop: 22, marginBottom: 8 },
  inputWrap: { flexDirection: 'row', borderRadius: 16, borderColor: C.border, borderWidth: 1, backgroundColor: C.card, padding: 5 },
  input: { flex: 1, paddingHorizontal: 11, fontFamily: 'Inter_400Regular', fontSize: 14, color: C.foreground, letterSpacing: 0.5 },
  lookupBtn: { backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', minHeight: 43 },
  lookupText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.primaryForeground },
});

import React, { useMemo, useState } from 'react';
import { Alert, Image, Keyboard, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DIMENSIONS, Product, PRODUCTS, useLiv } from '../state/LivContext';
import colors from '../constants/colors';
import { CatalogProduct, getCatalogProduct, searchCatalog } from '../lib/catalog';

const C = colors.light;
const display = 'Manrope_700Bold';
const body = 'Inter_400Regular';
const medium = 'Inter_500Medium';
const semi = 'Inter_600SemiBold';

function Txt({ children, style, ...props }: any) { return <Text {...props} style={[s.text, style]}>{children}</Text>; }
function Page({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  if (!scroll) return <View style={[s.page, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 14 }]}>{children}</View>;
  return <ScrollView style={s.page} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 18) + 100, paddingHorizontal: 20 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>;
}
function Header({ title, back = false, action, onAction }: { title: string; back?: boolean; action?: string; onAction?: () => void }) {
  const router = useRouter();
  return <View style={s.header}>
    {back ? <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={s.iconBtn}><Feather name="arrow-left" size={21} color={C.foreground}/></Pressable> : <Txt style={s.wordmark}>liv.</Txt>}
    <Txt style={s.headerTitle}>{title}</Txt>
    {action ? <Pressable onPress={onAction} accessibilityRole="button" style={s.headerAction}><Txt style={s.headerActionText}>{action}</Txt></Pressable> : <View style={{ width: 36 }}/>}
  </View>;
}
function DemoTag({ label = 'DEMO CONTENT' }: { label?: string }) { return <View style={s.demoTag}><View style={s.demoDot}/><Txt style={s.demoText}>{label}</Txt></View>; }
function Button({ title, onPress, secondary = false, icon }: { title: string; onPress: () => void; secondary?: boolean; icon?: any }) {
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.button, secondary && s.buttonSecondary, pressed && s.pressed]}>
    {icon && <Feather name={icon} size={17} color={secondary ? C.primary : C.primaryForeground}/>}
    <Txt style={[s.buttonText, secondary && s.buttonSecondaryText]}>{title}</Txt>
  </Pressable>;
}
function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!active }} style={[s.chip, active && s.chipActive]}><Txt style={[s.chipText, active && s.chipTextActive]}>{label}</Txt></Pressable>;
}
function SectionTitle({ children, action, onAction }: any) {
  return <View style={s.sectionRow}><Txt style={s.sectionTitle}>{children}</Txt>{action && <Pressable onPress={onAction}><Txt style={s.smallLink}>{action}</Txt></Pressable>}</View>;
}
function ProductCard({ product, compact = false }: { product: Product; compact?: boolean }) {
  const router = useRouter();
  const { saved, toggleSaved, addCompare, visit } = useLiv();
  const open = () => { visit(product.id); router.push(`/product/${product.id}`); };
  return <View style={[s.productCard, compact && s.productCompact]}>
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`View sample profile: ${product.brand} ${product.name}`}><Image source={product.image} style={[s.productImage, compact && s.productImageCompact]} accessibilityLabel={`Demo product image for ${product.name}`} /></Pressable>
    <View style={s.productInfo}>
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`View sample profile: ${product.brand} ${product.name}`}><Txt style={s.brand}>{product.brand}</Txt><Txt style={s.productName} numberOfLines={2}>{product.name}</Txt><Txt style={s.productMeta}>{product.category} · {product.price}</Txt></Pressable>
      <View style={s.cardFoot}><View style={s.rating}><Feather name="star" size={13} color={C.primary}/><Txt style={s.ratingText}>{product.rating.toFixed(1)} <Txt style={s.mutedText}>sample</Txt></Txt></View>
        <View style={s.cardActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={saved.includes(product.id) ? 'Unsave product' : 'Save product'} onPress={() => toggleSaved(product.id)} hitSlop={8} style={s.miniIcon}><Feather name={saved.includes(product.id) ? 'bookmark' : 'bookmark'} size={17} color={saved.includes(product.id) ? C.primary : C.mutedForeground}/></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Add product to compare" onPress={() => addCompare(product.id)} hitSlop={8} style={s.miniIcon}><Feather name="columns" size={17} color={C.mutedForeground}/></Pressable>
        </View>
      </View>
    </View>
  </View>;
}

export function HomeScreen() {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const { prefs } = useLiv();
  return <Page><Header title="Thoughtful choices"/><View style={s.hero}>
    <View style={s.heroTop}><Txt style={s.eyebrow}>A LITTLE MORE CLARITY</Txt><Feather name="feather" size={17} color={C.gold}/></View>
    <Txt style={s.heroTitle}>Before you buy it, ask Liv.</Txt>
    <Txt style={s.heroCopy}>A calmer way to understand what’s in the things you bring home.</Txt>
    <View style={s.composer}><TextInput value={draft} onChangeText={setDraft} placeholder="Ask about a product or ingredient…" placeholderTextColor={C.mutedForeground} style={s.composerInput} accessibilityLabel="Ask Liv a question" returnKeyType="send" onSubmitEditing={() => {}}/>
      <Pressable onPress={() => { if (draft.trim()) router.push({ pathname: '/ask', params: { q: draft.trim() } }); }} accessibilityRole="button" accessibilityLabel="Send question to Liv" style={[s.sendBtn, !draft.trim() && s.sendDisabled]}><Feather name="arrow-up" size={19} color={C.primaryForeground}/></Pressable>
    </View>
    <Pressable onPress={() => router.push('/ask')} style={s.textLink}><Txt style={s.textLinkLabel}>Ask Liv</Txt><Feather name="arrow-up-right" size={14} color={C.primary}/></Pressable>
  </View>
  {!prefs.onboardingComplete && <Pressable onPress={() => router.push('/onboarding')} style={s.onboardStrip}><View style={s.onboardIcon}><Feather name="sliders" size={19} color={C.primary}/></View><View style={{ flex: 1 }}><Txt style={s.onboardTitle}>Make this feel like yours</Txt><Txt style={s.onboardCopy}>Set interests and priorities · optional</Txt></View><Feather name="chevron-right" size={19} color={C.mutedForeground}/></Pressable>}
  <DemoTag label="LOCAL SAMPLE SET"/>
  <SectionTitle action="See all" onAction={() => router.push('/search')}>For your routine</SectionTitle>
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 20 }}>{PRODUCTS.map((p) => <ProductCard key={p.id} product={p} compact/>)}</ScrollView>
  <View style={s.sectionRow}><Txt style={s.sectionTitle}>Start with a question</Txt></View>
  <View style={s.quickGrid}><QuickAction icon="search" label="Search products" onPress={() => router.push('/search')}/><QuickAction icon="maximize" label="Enter a code" onPress={() => router.push('/scan')}/><QuickAction icon="users" label="Community" onPress={() => router.push('/community')}/></View>
  <View style={s.noteCard}><Feather name="info" size={17} color={C.primary}/><Txt style={s.noteText}>Every product profile and score here is sample content—not research, medical advice, or a live lookup.</Txt></View>
  </Page>;
}
function QuickAction({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [s.quickCard, pressed && s.pressed]} accessibilityRole="button"><Feather name={icon} size={19} color={C.primary}/><Txt style={s.quickLabel}>{label}</Txt></Pressable>;
}

export function SearchScreen() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const filters = ['All', 'Skincare', 'Hair', 'Body', 'Home'];
  const matches = useMemo(() => PRODUCTS.filter((p) => (filter === 'All' || p.category === filter) && `${p.name} ${p.brand} ${p.category} ${p.ingredients.map((i) => i.name).join(' ')}`.toLowerCase().includes(query.toLowerCase().trim())), [query, filter]);
  React.useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setCatalogLoading(true);
      searchCatalog(query).then((items) => {
        if (active) { setCatalog(items); setCatalogError(''); }
      }).catch((error: unknown) => {
        if (active) setCatalogError(error instanceof Error ? error.message : 'Sourced products are unavailable.');
      }).finally(() => { if (active) setCatalogLoading(false); });
    }, 220);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  return <Page><Header title="Search"/><View style={s.pageIntro}><Txt style={s.pageTitle}>Find your next<br/>informed choice.</Txt><Txt style={s.introCopy}>Search a product, brand, category or ingredient.</Txt></View>
    <View style={s.searchBox}><Feather name="search" size={18} color={C.mutedForeground}/><TextInput value={query} onChangeText={setQuery} placeholder="Try “ceramides”" placeholderTextColor={C.mutedForeground} style={s.searchInput} autoCorrect={false} accessibilityLabel="Search products and ingredients"/>{query.length > 0 && <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear search"><Feather name="x-circle" size={18} color={C.mutedForeground}/></Pressable>}</View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>{filters.map((x) => <Chip key={x} label={x} active={filter === x} onPress={() => setFilter(x)}/>)}</ScrollView>
    <View style={s.sourceHeading}><SectionTitle>Sourced skincare pilot</SectionTitle><Txt style={s.sourceCaption}>Open Beauty Facts · community-submitted records</Txt></View>
    {catalogLoading && <Txt style={s.scoreMeta}>Loading sourced records…</Txt>}
    {!!catalogError && <View style={s.unknownCard}><Feather name="wifi-off" size={17} color={C.primary}/><Txt style={[s.consentCopy,{flex:1}]}>{catalogError} Try again when the catalog is available.</Txt></View>}
    {!catalogLoading && !catalogError && catalog.filter((p) => filter === 'All' || filter === 'Skincare').length === 0 && <Txt style={s.scoreMeta}>No sourced match in this small pilot.</Txt>}
    {catalog.filter((p) => filter === 'All' || filter === 'Skincare').map((p) => <CatalogProductCard key={p.id} product={p}/>)}
    <SectionTitle>Illustrative demo products</SectionTitle>
    <DemoTag/><SectionTitle>{query ? `${matches.length} sample result${matches.length === 1 ? '' : 's'}` : 'A few places to begin'}</SectionTitle>
    {matches.length ? matches.map((p) => <ProductCard key={p.id} product={p}/>) : <View style={s.emptyCard}><View style={s.emptyIcon}><Feather name="search" size={21} color={C.primary}/></View><Txt style={s.emptyTitle}>Nothing in this small sample set</Txt><Txt style={s.emptyCopy}>Try another name or ingredient, or reset your filters.</Txt><Button title="Reset search" secondary onPress={() => { setQuery(''); setFilter('All'); }}/></View>}
  </Page>;
}

function CatalogProductCard({ product }: { product: CatalogProduct }) {
  const router = useRouter();
  return <Pressable onPress={() => router.push(`/product/${product.id}`)} style={[s.productCard,s.catalogCard]} accessibilityRole="button" accessibilityLabel={`View sourced record: ${product.brand} ${product.name}`}>
    <View style={s.productInfo}><Txt style={s.brand}>{product.brand}</Txt><Txt style={s.productName}>{product.name}</Txt><Txt style={s.productMeta}>{product.quantity || 'Package size not listed'} · barcode {product.id}</Txt><Txt style={s.scoreMeta}>Community-submitted · not independently verified</Txt></View>
    <Feather name="chevron-right" size={18} color={C.mutedForeground}/>
  </Pressable>;
}

export function ScanScreen() {
  const [code, setCode] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const found = PRODUCTS.find((p) => p.code.toLowerCase() === code.trim().toLowerCase());
  const router = useRouter();
  return <Page><Header title="Product code"/><View style={s.scanHero}><View style={s.scanGlyph}><Feather name="maximize" size={33} color={C.primary}/></View><Txt style={s.pageTitle}>A manual lookup,<br/>not a live scan.</Txt><Txt style={s.introCopy}>Liv doesn’t use your camera or connect to a barcode database in this demo. Enter one of the sample codes to explore a product profile.</Txt></View>
    <View style={s.demoBanner}><Feather name="alert-circle" size={17} color={C.primary}/><Txt style={s.bannerCopy}>Manual-code demo only · no camera, no internet lookup</Txt></View>
    <Txt style={s.inputLabel}>Barcode or sample code</Txt><View style={s.codeInputWrap}><TextInput value={code} onChangeText={(v) => { setCode(v); setSubmitted(false); }} placeholder="Enter a code" placeholderTextColor={C.mutedForeground} style={s.codeInput} accessibilityLabel="Enter a sample product code" autoCapitalize="characters"/><Pressable onPress={() => { Keyboard.dismiss(); setSubmitted(true); }} accessibilityRole="button" style={s.lookupBtn}><Txt style={s.lookupText}>Look up</Txt></Pressable></View>
    {submitted && found && <Pressable onPress={() => router.push(`/product/${found.id}`)} style={s.foundCard}><Image source={found.image} style={s.foundImage}/><View style={{ flex: 1 }}><Txt style={s.brand}>{found.brand}</Txt><Txt style={s.productName}>{found.name}</Txt><Txt style={s.smallLink}>Open sample profile  ›</Txt></View></Pressable>}
    {submitted && !found && <View style={s.emptyCard}><Feather name="help-circle" size={24} color={C.primary}/><Txt style={s.emptyTitle}>No sample match</Txt><Txt style={s.emptyCopy}>No matching product exists in this local demo set. You can search by product or ingredient instead.</Txt><Button title="Search the sample set" secondary onPress={() => router.push('/search')}/></View>}
    <SectionTitle>Sample codes</SectionTitle>{PRODUCTS.map((p) => <Pressable key={p.id} onPress={() => setCode(p.code)} style={s.codeRow}><Feather name="tag" size={16} color={C.primary}/><Txt style={s.codeProduct}>{p.name}</Txt><Txt style={s.code}>{p.code}</Txt></Pressable>)}
  </Page>;
}

export function CommunityScreen() {
  const [filter, setFilter] = useState('For you');
  const categories = ['For you', 'Skincare', 'Hair', 'Home'];
  const router = useRouter();
  return <Page><Header title="Community"/><View style={s.pageIntro}><Txt style={s.pageTitle}>A shared point of view.</Txt><Txt style={s.introCopy}>Illustrative conversations, clearly marked as samples.</Txt></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>{categories.map((c) => <Chip key={c} label={c} active={filter === c} onPress={() => setFilter(c)}/>)}</ScrollView>
    <DemoTag label="SAMPLE COMMUNITY CONTENT"/>
    {(filter === 'For you' || filter === 'Skincare') && <View style={s.communityPost}><View style={s.postHead}><View style={s.initialAvatar}><Txt style={s.avatarText}>SR</Txt></View><View style={{ flex: 1 }}><Txt style={s.postName}>Sample reader</Txt><Txt style={s.postMeta}>Skincare · illustrative post</Txt></View><Feather name="more-horizontal" size={20} color={C.mutedForeground}/></View>
      <Txt style={s.postText}>Has anyone compared everyday moisturizers for a simple, fragrance-free routine?</Txt><Txt style={s.postDisclaimer}>This is a fictional prompt for exploring the community screen.</Txt>
      <Pressable onPress={() => router.push('/product/daily-cream')} style={s.postProduct}><Image source={PRODUCTS[0].image} style={s.postProductImage}/><View style={{ flex: 1 }}><Txt style={s.postProductName}>Liv Sample Barrier Cream</Txt><Txt style={s.productMeta}>Sample product · demo profile</Txt></View><Feather name="chevron-right" size={18} color={C.mutedForeground}/></Pressable>
      <View style={s.postFooter}><View style={s.row}><Feather name="message-circle" size={15} color={C.mutedForeground}/><Txt style={s.productMeta}>Sample discussion</Txt></View><Pressable onPress={() => router.push({ pathname: '/ask', params: { product: 'daily-cream' } })} style={s.askPill}><Feather name="message-square" size={14} color={C.primaryForeground}/><Txt style={s.askPillText}>Ask Liv</Txt></Pressable></View>
    </View>}
    {filter === 'For you' && <View style={s.communityPost}><View style={s.postHead}><View style={[s.initialAvatar, { backgroundColor: C.sage }]}><Txt style={s.avatarText}>ER</Txt></View><View style={{ flex: 1 }}><Txt style={s.postName}>Sample reader</Txt><Txt style={s.postMeta}>Routine notes · illustrative post</Txt></View></View><Txt style={s.postText}>I’m learning to check what’s actually listed—and what’s still unknown—before deciding.</Txt><Txt style={s.postDisclaimer}>Fictional sample content · no real member activity</Txt></View>}
    {(filter === 'Hair' || filter === 'Home') && <View style={s.emptyCard}><View style={s.emptyIcon}><Feather name="users" size={20} color={C.primary}/></View><Txt style={s.emptyTitle}>No sample conversations here yet</Txt><Txt style={s.emptyCopy}>This demo set only includes illustrative skincare examples. Try For you or Skincare.</Txt></View>}
  </Page>;
}

export function ProfileScreen() {
  const router = useRouter(); const { prefs, setPrefs, saved, recent } = useLiv();
  return <Page><Header title="Your space" action="Edit" onAction={() => router.push('/onboarding')}/>
    <View style={s.profileHero}><View style={s.profileAvatar}><Txt style={s.profileInitial}>L</Txt></View><View style={{ flex: 1 }}><Txt style={s.profileName}>A more personal Liv</Txt><Txt style={s.productMeta}>Preferences stay on this device</Txt></View><Feather name="settings" size={19} color={C.primary}/></View>
    <View style={s.statsRow}><Stat value={String(recent.length)} label="Viewed"/><Stat value={String(saved.length)} label="Saved"/><Stat value={String(prefs.priorities.length)} label="Priorities"/></View>
    <SectionTitle>What matters to you</SectionTitle><View style={s.preferenceCard}><Txt style={s.preferenceLabel}>Interests</Txt><View style={s.wrapChips}>{(prefs.interests.length ? prefs.interests : ['Not set']).map((v) => <View key={v} style={s.prefChip}><Txt style={s.prefChipText}>{v}</Txt></View>)}</View><Txt style={s.preferenceLabel}>Priorities</Txt><View style={s.wrapChips}>{(prefs.priorities.length ? prefs.priorities : ['Not set']).map((v) => <View key={v} style={s.prefChip}><Txt style={s.prefChipText}>{v}</Txt></View>)}</View><Pressable onPress={() => router.push('/onboarding')} style={s.editRow}><Txt style={s.smallLink}>Edit preferences</Txt><Feather name="arrow-right" size={15} color={C.primary}/></Pressable></View>
    <SectionTitle>Privacy, your way</SectionTitle><View style={s.consentCard}><View style={{ flex: 1 }}><Txt style={s.preferenceLabel}>Remember my preferences</Txt><Txt style={s.consentCopy}>Separate, optional permission. Your saved items stay local either way.</Txt></View><Switch value={prefs.memoryConsent} onValueChange={(value) => setPrefs({ ...prefs, memoryConsent: value })} trackColor={{ false: C.border, true: C.sage }} thumbColor={C.card} accessibilityLabel="Allow Liv to remember preferences"/></View>
    <SectionTitle>Your Liv</SectionTitle><MenuRow icon="bookmark" title="Saved items & lists" detail={`${saved.length} saved products`} onPress={() => router.push('/saved')}/><MenuRow icon="clock" title="Recently viewed" detail={`${recent.length} sample profiles`} onPress={() => router.push('/saved?tab=history')}/><MenuRow icon="columns" title="Compare products" detail="Choose exactly two" onPress={() => router.push('/compare')}/><MenuRow icon="info" title="About this demo" detail="Local sample data only" onPress={() => Alert.alert('Liv · M0 demo', 'All scores, products, reviews, and ingredient summaries are illustrative sample content. No live lookup or sourced research is used.')}/>
  </Page>;
}
function Stat({ value, label }: { value: string; label: string }) { return <View style={s.stat}><Txt style={s.statValue}>{value}</Txt><Txt style={s.statLabel}>{label}</Txt></View>; }
function MenuRow({ icon, title, detail, onPress }: any) { return <Pressable onPress={onPress} style={({ pressed }) => [s.menuRow, pressed && s.pressed]} accessibilityRole="button"><View style={s.menuIcon}><Feather name={icon} size={18} color={C.primary}/></View><View style={{ flex: 1 }}><Txt style={s.menuTitle}>{title}</Txt><Txt style={s.menuDetail}>{detail}</Txt></View><Feather name="chevron-right" size={18} color={C.mutedForeground}/></Pressable>; }

export function OnboardingScreen() {
  const router = useRouter(); const { prefs, setPrefs } = useLiv();
  const [interest, setInterest] = useState(prefs.interests); const [priority, setPriority] = useState(prefs.priorities);
  const [restriction, setRestriction] = useState(prefs.restrictions); const [note, setNote] = useState(prefs.note);
  const [step, setStep] = useState(0);
  const interests = ['Skincare', 'Hair', 'Body', 'Home', 'Wellness'];
  const priorities = ['Ingredients', 'Effectiveness', 'Fragrance-free', 'Value', 'Sustainability', 'Transparency'];
  const toggle = (arr: string[], set: (x: string[]) => void, item: string) => set(arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item]);
  const finish = () => { setPrefs({ ...prefs, interests: interest, priorities: priority, restrictions: restriction, note, onboardingComplete: true }); router.replace('/(tabs)'); };
  const skip = () => { setPrefs({ ...prefs, onboardingComplete: true }); router.replace('/(tabs)'); };
  return <Page><Header title="Your preferences" back action={step > 0 ? 'Back' : 'Skip'} onAction={() => step > 0 ? setStep(step - 1) : skip()}/>
    <View style={s.pageIntro}><Txt style={s.eyebrow}>A SMALL START · {step + 1} OF 3</Txt><Txt style={s.pageTitle}>{step === 0 ? 'What do you shop for?' : step === 1 ? 'What matters most?' : 'Anything else to know?'}</Txt><Txt style={s.introCopy}>{step === 2 ? 'Optional context can help frame a useful explanation. This is not medical advice.' : 'Choose what feels relevant. You can revisit or change this whenever you like.'}</Txt></View>
    {step === 0 && <View style={s.wrapChips}>{interests.map((x) => <Chip key={x} label={x} active={interest.includes(x)} onPress={() => toggle(interest, setInterest, x)}/>)}</View>}
    {step === 1 && <View style={s.wrapChips}>{priorities.map((x) => <Chip key={x} label={x} active={priority.includes(x)} onPress={() => toggle(priority, setPriority, x)}/>)}</View>}
    {step === 2 && <><Txt style={s.inputLabel}>Optional restrictions or sensitivities</Txt><View style={s.wrapChips}>{['Fragrance', 'Sensitive skin', 'Avoid certain ingredients'].map((x) => <Chip key={x} label={x} active={restriction.includes(x)} onPress={() => toggle(restriction, setRestriction, x)}/>)}</View><TextInput value={note} onChangeText={setNote} placeholder="Anything else? (optional)" placeholderTextColor={C.mutedForeground} style={[s.formInput, { minHeight: 90 }]} multiline textAlignVertical="top" accessibilityLabel="Optional preference note"/><View style={s.consentCard}><View style={{ flex: 1 }}><Txt style={s.preferenceLabel}>Let Liv remember preferences</Txt><Txt style={s.consentCopy}>Optional and separate from sharing. Stored locally on this device.</Txt></View><Switch value={prefs.memoryConsent} onValueChange={(v) => setPrefs({ ...prefs, memoryConsent: v })} trackColor={{ false: C.border, true: C.sage }} thumbColor={C.card} accessibilityLabel="Opt in to remembering preferences"/></View></>}
    <View style={s.onboardingBottom}>{step < 2 ? <><Button title="Continue" onPress={() => setStep(step + 1)}/><Pressable onPress={() => setStep(step + 1)} style={s.skipBtn}><Txt style={s.smallLink}>Skip this question</Txt></Pressable></> : <Button title="Save my preferences" onPress={finish}/>}<Txt style={s.privacyFoot}>You’re in control. Preferences can be edited or cleared at any time.</Txt></View>
  </Page>;
}

export function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const product = PRODUCTS.find((item) => item.id === id);
  return product ? <DemoProductDetail product={product}/> : <SourcedProductDetail id={String(id ?? '')}/>;
}

function DemoProductDetail({ product }: { product: Product }) {
  const router = useRouter();
  const { saved, toggleSaved, addCompare, visit } = useLiv();
  React.useEffect(() => { visit(product.id); }, [product.id]);
  return <Page><Header title="Product details" back action={saved.includes(product.id) ? 'Saved' : 'Save'} onAction={() => toggleSaved(product.id)}/>
    <View style={s.detailImageWrap}><Image source={product.image} style={s.detailImage} accessibilityLabel={`Demo product image for ${product.name}`}/><View style={s.imageDemo}><DemoTag label="SAMPLE PRODUCT"/></View></View>
    <View style={s.productHeading}><Txt style={s.brand}>{product.brand}</Txt><Txt style={s.detailTitle}>{product.name}</Txt><Txt style={s.introCopy}>{product.description}</Txt><View style={s.ratingLine}><Feather name="star" size={15} color={C.primary}/><Txt style={s.ratingText}>{product.rating.toFixed(1)} / 5</Txt><Txt style={s.productMeta}>· {product.reviewCount.toLocaleString()} illustrative reviews</Txt></View></View>
    <View style={s.fitCard}><View style={s.row}><Feather name="star" size={17} color={C.primary}/><Txt style={s.fitTitle}>A possible fit for your routine</Txt></View><Txt style={s.fitCopy}>Fragrance-free is one of your selected priorities. This is a sample explanation, not a personalized health assessment or guarantee.</Txt></View>
    <SectionTitle>Liv’s breakdown</SectionTitle><Txt style={s.subtleDisclaimer}>Five separate dimensions · no overall score · all values are demo data</Txt>
    {DIMENSIONS.map((dimension) => { const score = product.scores[dimension]; return <View key={dimension} style={s.scoreRow}><View style={s.scoreTop}><Txt style={s.scoreName}>{dimension}</Txt><Txt style={s.scoreValue}>{score.value}<Txt style={s.scoreOut}>/100</Txt></Txt></View><View style={s.scoreTrack}><View style={[s.scoreFill, { width: `${score.value}%` }]}/></View><Txt style={s.scoreRationale}>{score.rationale}</Txt><Txt style={s.scoreMeta}>Confidence: {score.confidence} · Coverage: {score.coverage}</Txt><Txt style={s.scoreMeta}>{score.evidenceLabel} · Source: {score.sourceMetadata}</Txt></View>; })}
    <SectionTitle>Ingredient notes</SectionTitle><Txt style={s.subtleDisclaimer}>Evidence labels and summaries below are illustrative—not a sourced research review.</Txt>
    {product.ingredients.map((i) => <View key={i.name} style={s.ingredientCard}><View style={s.ingredientHeader}><Txt style={s.ingredientName}>{i.name}</Txt><Txt style={s.evidenceLabel}>{i.label}</Txt></View><Txt style={s.ingredientNote}>{i.note}</Txt><Txt style={s.scoreMeta}>Sample evidence summary · Source: {i.sourceMetadata}</Txt></View>)}
    <View style={s.unknownCard}><Feather name="help-circle" size={18} color={C.primary}/><View style={{ flex: 1 }}><Txt style={s.unknownTitle}>What we don’t know</Txt><Txt style={s.consentCopy}>Formula concentrations, individual reactions, and current packaging details are not verified here.</Txt></View></View>
    <SectionTitle>From the sample community</SectionTitle><Pressable onPress={() => router.push('/community')} style={s.reviewCard}><DemoTag label="ILLUSTRATIVE REVIEWS"/><Txt style={s.postText}>“Comfortable for my simple evening routine.”</Txt><Txt style={s.postDisclaimer}>Fictional sample review · not a real customer statement</Txt><Txt style={s.smallLink}>See community context →</Txt></Pressable>
    <SectionTitle>Similar sample products</SectionTitle>{PRODUCTS.filter((p) => p.id !== product.id).slice(0, 2).map((p) => <ProductCard key={p.id} product={p}/>)}
    <View style={s.actionRow}><Button title="Compare" secondary icon="columns" onPress={() => { addCompare(product.id); router.push('/compare'); }}/><Button title="Ask Liv" icon="message-square" onPress={() => router.push({ pathname: '/ask', params: { product: product.id } })}/></View>
    <Txt style={s.verified}>Last verified: {product.lastVerified} · Not a live product lookup</Txt>
  </Page>;
}

function SourcedProductDetail({ id }: { id: string }) {
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [error, setError] = useState('');
  React.useEffect(() => {
    let active = true;
    getCatalogProduct(id).then((item) => { if (active) { setProduct(item); setError(''); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load this sourced record.'); });
    return () => { active = false; };
  }, [id]);
  const router = useRouter();
  if (error) return <Page><Header title="Product details" back/><View style={s.emptyCard}><Txt style={s.emptyTitle}>Sourced record unavailable</Txt><Txt style={s.emptyCopy}>{error}</Txt><Button title="Back to search" secondary onPress={() => router.back()}/></View></Page>;
  if (!product) return <Page><Header title="Product details" back/><Txt style={s.scoreMeta}>Loading sourced product…</Txt></Page>;
  const staleSources = product.sources.filter((source) => source.sourceUpdatedAt && Date.now() - new Date(source.sourceUpdatedAt).getTime() > 180 * 24 * 60 * 60 * 1000);
  return <Page><Header title="Product details" back/>
    <View style={s.pageIntro}><Txt style={s.brand}>{product.brand}</Txt><Txt style={s.pageTitle}>{product.name}</Txt><Txt style={s.introCopy}>{product.category} · {product.quantity || 'Package size not supplied'} · barcode {product.id}</Txt></View>
    <View style={s.unknownCard}><Feather name="alert-circle" size={18} color={C.primary}/><View style={{flex:1}}><Txt style={s.unknownTitle}>Community-submitted product record</Txt><Txt style={s.consentCopy}>Ingredient data comes from a public collaborative database and has not been independently confirmed against this package. Check the label before relying on it.</Txt></View></View>
    {staleSources.length > 0 && <View style={s.unknownCard}><Feather name="clock" size={18} color={C.primary}/><Txt style={[s.consentCopy,{flex:1}]}>A source record is over six months old. Treat its product details as potentially outdated until the current package is checked.</Txt></View>}
    <SectionTitle>Liv’s breakdown</SectionTitle><Txt style={s.subtleDisclaimer}>Separate dimensions · no combined score. Numbers appear only when the evidence supports the method.</Txt>
    {product.scores.map((score) => <View key={score.dimension} style={s.scoreRow}><View style={s.scoreTop}><Txt style={s.scoreName}>{score.dimension}</Txt><Txt style={s.scoreMeta}>{score.value == null ? 'Not enough information' : `${score.value}/100`}</Txt></View>{score.value != null && <View style={s.scoreTrack}><View style={[s.scoreFill,{width:`${score.value}%`}]}/></View>}<Txt style={s.scoreRationale}>{score.rationale}</Txt><Txt style={s.scoreMeta}>Method: {score.method}</Txt><Txt style={s.scoreMeta}>Coverage: {score.coverage}</Txt></View>)}
    <View style={s.ratingUnavailable}><Feather name="star" size={17} color={C.primary}/><Txt style={s.consentCopy}>Community rating: not available. This pilot has no verified review source or Liv member reviews.</Txt></View>
    <SectionTitle>Ingredient label record</SectionTitle><Txt style={s.subtleDisclaimer}>Raw text from the cited community database; not a verified formula or safety assessment.</Txt>
    <View style={s.ingredientCard}><Txt style={s.ingredientNote}>{product.ingredientsText || 'No ingredient list is available for this record.'}</Txt></View>
    {!!product.ingredientEvidence.length && <><SectionTitle>Ingredient-level research</SectionTitle>{product.ingredientEvidence.map((item) => <View key={item.url} style={s.ingredientCard}><Txt style={s.ingredientName}>{item.ingredient}: {item.title}</Txt><Txt style={s.ingredientNote}>{item.summary}</Txt><Txt style={s.scoreMeta}>{item.studyDesign} · Retrieved {item.retrievedAt}</Txt><Txt style={s.scoreMeta}>Coverage: {item.coverage}</Txt><Txt style={s.scoreMeta}>Confidence: {item.confidence}</Txt><Txt style={s.scoreMeta}>{item.limitation}</Txt><Pressable onPress={() => Linking.openURL(item.url)}><Txt style={s.smallLink}>Open PubMed source ↗</Txt></Pressable></View>)}</>}
    <SectionTitle>Sources</SectionTitle>{product.sources.map((source) => <Pressable key={source.url} onPress={() => Linking.openURL(source.url)} style={s.sourceRow}><View style={{flex:1}}><Txt style={s.postProductName}>{source.label}</Txt><Txt style={s.scoreMeta}>{source.note}</Txt><Txt style={s.scoreMeta}>{source.sourceUpdatedAt ? `Source record last changed ${source.sourceUpdatedAt} · ` : ''}Retrieved ${source.retrievedAt}{source.license ? ` · ${source.license}` : ''}</Txt></View><Feather name="external-link" size={16} color={C.primary}/></Pressable>)}
    <Txt style={s.verified}>Record last updated: {new Date(product.updatedAt).toLocaleDateString()}</Txt>
  </Page>;
}

export function AskScreen() {
  const router = useRouter(); const params = useLocalSearchParams<{ q?: string; product?: string }>();
  const product = params.product ? PRODUCTS.find((p) => p.id === params.product) : undefined;
  const [question, setQuestion] = useState(params.q ?? '');
  const [messages, setMessages] = useState<{ role: 'user' | 'liv'; text: string }[]>(params.q ? [{ role: 'user', text: params.q }, { role: 'liv', text: responseFor(params.q, product) }] : []);
  const send = (text = question) => { const clean = text.trim(); if (!clean) return; setMessages((prev) => [...prev, { role: 'user', text: clean }, { role: 'liv', text: responseFor(clean, product) }]); setQuestion(''); Keyboard.dismiss(); };
  const prompts = ['Is this ingredient safe?', 'What should I compare?', 'What’s still unknown?'];
  return <Page><Header title="Ask Liv" back action={undefined}/><View style={s.askWelcome}><View style={s.askBrandMark}><Txt style={s.askBrandText}>liv.</Txt></View><Txt style={s.pageTitle}>Curiosity, meet clarity.</Txt><Txt style={s.introCopy}>Ask about an ingredient, product, or trade-off. Liv’s reply is a scripted local demo—not research or medical advice.</Txt></View>
    {product && <Pressable onPress={() => router.push(`/product/${product.id}`)} style={s.contextProduct}><Image source={product.image} style={s.contextImage}/><View style={{ flex: 1 }}><Txt style={s.productMeta}>ASKING ABOUT</Txt><Txt style={s.postProductName}>{product.brand} · {product.name}</Txt></View><Feather name="arrow-up-right" size={17} color={C.primary}/></Pressable>}
    <DemoTag label="SCRIPTED LOCAL DEMO"/>
    {messages.length === 0 ? <><Txt style={s.sectionTitle}>A few things you could ask</Txt>{prompts.map((p) => <Pressable key={p} onPress={() => send(p)} style={s.suggestion}><Txt style={s.suggestionText}>{p}</Txt><Feather name="arrow-up-right" size={15} color={C.primary}/></Pressable>)}</> : messages.map((m, idx) => <View key={`${idx}-${m.role}`} style={[s.message, m.role === 'user' ? s.userMessage : s.livMessage]}><Txt style={[s.messageRole, m.role === 'user' && { color: C.primaryForeground }]}>{m.role === 'user' ? 'YOU · DEMO MESSAGE' : 'LIV · SCRIPTED DEMO RESPONSE'}</Txt><Txt style={[s.messageText, m.role === 'user' && { color: C.primaryForeground }]}>{m.text}</Txt>{m.role === 'liv' && product && <Pressable onPress={() => router.push(`/product/${product.id}`)}><Txt style={s.smallLink}>View product breakdown →</Txt></Pressable>}</View>)}
    {messages.length > 0 && <View style={[s.wrapChips, { marginTop: 8 }]}>{prompts.map((p) => <Chip key={p} label={p} onPress={() => send(p)}/>)}</View>}
    <View style={s.chatComposer}><TextInput value={question} onChangeText={setQuestion} placeholder="Ask a question…" placeholderTextColor={C.mutedForeground} style={s.chatInput} multiline accessibilityLabel="Write a question for Liv"/><Pressable onPress={() => send()} accessibilityRole="button" accessibilityLabel="Send message" style={[s.sendBtn, !question.trim() && s.sendDisabled]}><Feather name="arrow-up" size={19} color={C.primaryForeground}/></Pressable></View>
    <Txt style={s.subtleDisclaimer}>Responses are rule-based examples. No AI, internet, or health assessment is used.</Txt>
  </Page>;
}
function responseFor(question: string, product?: Product) {
  const q = question.toLowerCase();
  if (q.includes('safe') || q.includes('reaction')) return `“Safe” depends on the person, the formula, and how it is used. This local demo can’t establish universal safety or predict an individual reaction. ${product ? `For ${product.name}, the sample profile lists ${product.ingredients[0]?.name ?? 'ingredient notes'}; concentrations and your personal context are unknown.` : 'We can look at an ingredient’s general role and clearly name what remains unknown.'}`;
  if (q.includes('compare')) return 'A useful comparison starts with what matters to you: ingredient profile, expected use, transparency, community context, or price. Each dimension stays separate here—there is no combined Liv score.';
  if (q.includes('unknown')) return `${product ? `${product.name}: ` : ''}This demo does not verify current packaging, ingredient concentrations, product batches, or individual results. Its summaries and figures are sample content only.`;
  return `${product ? `About ${product.name}: ` : ''}Here’s a starting point, not a verdict: review the listed ingredient notes alongside the product’s intended use and your own preferences. This scripted sample has no sourced research; several details may be unknown.`;
}

export function CompareScreen() {
  const router = useRouter(); const { compare, addCompare, removeCompare } = useLiv();
  const selected = compare.map((id) => PRODUCTS.find((p) => p.id === id)).filter((p): p is Product => !!p).slice(0, 2);
  const available = PRODUCTS.filter((p) => !compare.includes(p.id));
  return <Page><Header title="Compare" back action="Clear" onAction={() => compare.forEach(removeCompare)}/><View style={s.pageIntro}><Txt style={s.pageTitle}>Two products.<br/>Your priorities.</Txt><Txt style={s.introCopy}>Compare dimensions side by side. No composite score, no single “winner.”</Txt></View><DemoTag/>
    <View style={s.compareProducts}>{[0, 1].map((i) => { const p = selected[i]; return p ? <View key={p.id} style={s.compareProduct}><Pressable onPress={() => router.push(`/product/${p.id}`)}><Image source={p.image} style={s.compareImage}/></Pressable><Pressable onPress={() => removeCompare(p.id)} style={s.removeCompare} accessibilityLabel={`Remove ${p.name} from comparison`}><Feather name="x" size={14} color={C.primary}/></Pressable><Txt style={s.brand}>{p.brand}</Txt><Txt style={s.compareName}>{p.name}</Txt></View> : <View key={`empty-${i}`} style={s.addProduct}><Feather name="plus-circle" size={25} color={C.primary}/><Txt style={s.addProductText}>Add a sample product</Txt></View>; })}</View>
    {available.length > 0 && selected.length < 2 && <><Txt style={s.inputLabel}>Add to comparison</Txt>{available.map((p) => <Pressable key={p.id} onPress={() => addCompare(p.id)} style={s.addRow}><Image source={p.image} style={s.addRowImage}/><View style={{ flex: 1 }}><Txt style={s.postProductName}>{p.brand}</Txt><Txt style={s.productMeta}>{p.name}</Txt></View><Feather name="plus" size={18} color={C.primary}/></Pressable>)}</>}
    {selected.length === 2 ? <>{DIMENSIONS.map((dim) => <View key={dim} style={s.compareDimension}><Txt style={s.compareDimensionTitle}>{dim}</Txt>{selected.map((p) => <View key={p.id} style={s.compareScore}><Txt style={s.scoreValue}>{p.scores[dim].value}<Txt style={s.scoreOut}>/100</Txt></Txt><View style={s.scoreTrack}><View style={[s.scoreFill, { width: `${p.scores[dim].value}%` }]}/></View><Txt style={s.scoreMeta}>{p.scores[dim].confidence} confidence</Txt></View>)}</View>)}<View style={s.unknownCard}><Feather name="help-circle" size={18} color={C.primary}/><Txt style={[s.consentCopy, { flex: 1 }]}>Unknowns remain: formulas and review examples are not verified. Differences are illustrative only.</Txt></View><Button title="Ask Liv about these two" icon="message-square" onPress={() => router.push('/ask')}/></> : <View style={s.emptyCard}><Txt style={s.emptyTitle}>Pick two to begin</Txt><Txt style={s.emptyCopy}>The second space stays open until you choose another product. Comparisons always use exactly two.</Txt></View>}
  </Page>;
}

export function SavedScreen() {
  const router = useRouter(); const params = useLocalSearchParams<{ tab?: string }>();
  const { saved, toggleSaved, collections, addCollection, renameCollection, deleteCollection, toggleCollectionProduct, recent } = useLiv();
  const [tab, setTab] = useState(params.tab === 'history' ? 'History' : 'Saved'); const [modal, setModal] = useState<'new' | 'rename' | null>(null);
  const [name, setName] = useState(''); const [target, setTarget] = useState<string | null>(null);
  const savedProducts = PRODUCTS.filter((p) => saved.includes(p.id)); const viewedProducts = recent.map((id) => PRODUCTS.find((p) => p.id === id)).filter((p): p is Product => !!p);
  const openRename = (id: string, oldName: string) => { setTarget(id); setName(oldName); setModal('rename'); };
  const submitModal = () => { if (modal === 'new') addCollection(name); else if (target) renameCollection(target, name.trim() || 'My list'); setModal(null); setName(''); };
  return <Page><Header title="Saved" back action="+ New list" onAction={() => { setName(''); setModal('new'); }}/><View style={s.pageIntro}><Txt style={s.pageTitle}>Keep what you’re weighing.</Txt><Txt style={s.introCopy}>Saved products and lists are stored on this device.</Txt></View>
    <View style={s.segment}><Chip label="Saved" active={tab === 'Saved'} onPress={() => setTab('Saved')}/><Chip label="Lists" active={tab === 'Lists'} onPress={() => setTab('Lists')}/><Chip label="History" active={tab === 'History'} onPress={() => setTab('History')}/></View><DemoTag label="LOCAL TO THIS DEVICE"/>
    {tab === 'Saved' && (savedProducts.length ? savedProducts.map((p) => <View key={p.id}><ProductCard product={p}/><Pressable onPress={() => toggleSaved(p.id)} style={s.unsave}><Feather name="bookmark" size={14} color={C.primary}/><Txt style={s.smallLink}>Remove from saved</Txt></Pressable></View>) : <View style={s.emptyCard}><View style={s.emptyIcon}><Feather name="bookmark" size={20} color={C.primary}/></View><Txt style={s.emptyTitle}>A little space for maybes</Txt><Txt style={s.emptyCopy}>Save products from their profile or search results and they’ll land here.</Txt><Button title="Explore sample products" secondary onPress={() => router.push('/search')}/></View>)}
    {tab === 'Lists' && <>{collections.map((list) => <View key={list.id} style={s.listCard}><View style={s.listHeading}><View style={s.listIcon}><Feather name="folder" size={18} color={C.primary}/></View><Pressable onPress={() => openRename(list.id, list.name)} style={{ flex: 1 }}><Txt style={s.listName}>{list.name}</Txt><Txt style={s.productMeta}>{list.productIds.length} sample product{list.productIds.length === 1 ? '' : 's'}</Txt></Pressable><Pressable onPress={() => Alert.alert('Delete this list?', `“${list.name}” and its saved associations will be removed.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete list', style: 'destructive', onPress: () => deleteCollection(list.id) }])} accessibilityRole="button" accessibilityLabel={`Delete ${list.name}`} style={s.miniIcon}><Feather name="trash-2" size={16} color={C.mutedForeground}/></Pressable></View>
      <View style={s.listProducts}>{list.productIds.length ? list.productIds.map((id) => { const p = PRODUCTS.find((x) => x.id === id); return p ? <View key={id} style={s.listProduct}><Image source={p.image} style={s.listProductImage}/><Pressable onPress={() => router.push(`/product/${id}`)} style={{ flex: 1 }} accessibilityRole="button"><Txt style={s.listProductName}>{p.name}</Txt></Pressable><Pressable onPress={() => toggleCollectionProduct(list.id, id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${p.name} from ${list.name}`}><Feather name="x-circle" size={17} color={C.mutedForeground}/></Pressable></View> : null; }) : <Txt style={s.productMeta}>No products yet. Add a sample below.</Txt>}
      <View style={s.wrapChips}>{PRODUCTS.filter((p) => !list.productIds.includes(p.id)).map((p) => <Chip key={p.id} label={`+ ${p.name}`} onPress={() => toggleCollectionProduct(list.id, p.id)}/>)}</View></View></View>)}
      <Button title="Create a new list" secondary icon="plus" onPress={() => { setName(''); setModal('new'); }}/></>}
    {tab === 'History' && (viewedProducts.length ? viewedProducts.map((p) => <ProductCard key={p.id} product={p}/>) : <View style={s.emptyCard}><View style={s.emptyIcon}><Feather name="clock" size={20} color={C.primary}/></View><Txt style={s.emptyTitle}>Your browsing, kept here</Txt><Txt style={s.emptyCopy}>Product profiles you open will appear in your local history.</Txt><Button title="Explore products" secondary onPress={() => router.push('/search')}/></View>)}
    <Modal visible={!!modal} transparent animationType="fade" onRequestClose={() => setModal(null)}><View style={s.modalBackdrop}><View style={s.modalCard}><Txt style={s.modalTitle}>{modal === 'new' ? 'A new list' : 'Rename list'}</Txt><TxtInputLabel/><TextInput value={name} onChangeText={setName} placeholder="List name" placeholderTextColor={C.mutedForeground} style={s.formInput} autoFocus accessibilityLabel="List name"/><View style={s.modalActions}><Button title="Cancel" secondary onPress={() => setModal(null)}/><Button title="Save" onPress={submitModal}/></View></View></View></Modal>
  </Page>;
}
function TxtInputLabel() { return <Txt style={s.inputLabel}>Give it a name</Txt>; }

const s = StyleSheet.create({
  text: { color: C.foreground, fontFamily: body, fontSize: 14, lineHeight: 21 },
  page: { flex: 1, backgroundColor: C.background }, header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  wordmark: { fontFamily: display, color: C.primary, fontSize: 23, letterSpacing: -1.5, width: 40 }, headerTitle: { fontFamily: semi, fontSize: 15, color: C.foreground },
  iconBtn: { width: 38, height: 38, alignItems: 'flex-start', justifyContent: 'center' }, headerAction: { minWidth: 45, alignItems: 'flex-end', justifyContent: 'center', minHeight: 40 }, headerActionText: { fontFamily: semi, color: C.primary, fontSize: 13 },
  hero: { backgroundColor: C.primary, borderRadius: 26, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 19, marginBottom: 18 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 23 }, eyebrow: { fontFamily: semi, color: C.primary, fontSize: 10, letterSpacing: 1.5 }, goldMark: { color: C.gold },
  heroTitle: { fontFamily: display, color: C.primaryForeground, fontSize: 29, lineHeight: 37, letterSpacing: -1, maxWidth: 290 },
  heroCopy: { fontFamily: body, color: '#F0E6EA', fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 295 },
  composer: { minHeight: 52, borderRadius: 16, backgroundColor: C.card, marginTop: 21, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6 },
  composerInput: { flex: 1, color: C.foreground, fontFamily: body, fontSize: 13, paddingVertical: 12 }, sendBtn: { width: 39, height: 39, borderRadius: 13, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }, sendDisabled: { opacity: 0.48 },
  textLink: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end', marginTop: 11 }, textLinkLabel: { color: C.primaryForeground, fontFamily: semi, fontSize: 12 },
  onboardStrip: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.lavender, borderRadius: 18, padding: 14, marginBottom: 23 }, onboardIcon: { width: 38, height: 38, backgroundColor: C.card, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, onboardTitle: { fontFamily: semi, fontSize: 13, color: C.foreground }, onboardCopy: { fontFamily: body, color: C.mutedForeground, fontSize: 11, marginTop: 3 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, marginBottom: 12 }, sectionTitle: { fontFamily: display, fontSize: 17, lineHeight: 23, color: C.foreground, letterSpacing: -0.3 }, smallLink: { color: C.primary, fontFamily: semi, fontSize: 12 },
  productCard: { flexDirection: 'row', gap: 13, backgroundColor: C.card, borderRadius: 19, borderWidth: 1, borderColor: C.border, padding: 10, marginBottom: 12, minHeight: 124 },
  productCompact: { width: 232, marginBottom: 0, flexDirection: 'column', padding: 9 }, productImage: { width: 92, height: 102, borderRadius: 13, backgroundColor: C.muted }, productImageCompact: { height: 106, width: '100%' },
  productInfo: { flex: 1, justifyContent: 'center' }, brand: { fontFamily: semi, fontSize: 11, color: C.taupe, marginBottom: 3 }, productName: { fontFamily: semi, fontSize: 14, color: C.foreground, lineHeight: 19 }, productMeta: { fontFamily: body, color: C.mutedForeground, fontSize: 11, lineHeight: 16, marginTop: 3 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }, rating: { flexDirection: 'row', alignItems: 'center', gap: 4 }, ratingText: { fontFamily: semi, fontSize: 11, color: C.foreground }, mutedText: { color: C.mutedForeground, fontFamily: body }, cardActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  miniIcon: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' }, pressed: { opacity: 0.74 },
  quickGrid: { flexDirection: 'row', gap: 9, marginBottom: 17 }, quickCard: { flex: 1, minHeight: 78, borderRadius: 16, padding: 12, backgroundColor: C.lavender, justifyContent: 'space-between' }, quickLabel: { fontFamily: semi, fontSize: 11, color: C.foreground, lineHeight: 14 },
  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: C.card, borderRadius: 15, borderWidth: 1, borderColor: C.border, padding: 13 }, noteText: { flex: 1, fontFamily: body, fontSize: 11, lineHeight: 17, color: C.mutedForeground },
  pageIntro: { marginTop: 10, marginBottom: 18 }, pageTitle: { fontFamily: display, fontSize: 29, lineHeight: 36, letterSpacing: -0.9, color: C.foreground }, introCopy: { fontFamily: body, color: C.mutedForeground, fontSize: 13, lineHeight: 20, marginTop: 7 },
  searchBox: { height: 51, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 9, marginBottom: 13 }, searchInput: { flex: 1, paddingVertical: 10, fontFamily: body, fontSize: 13, color: C.foreground },
  chipRow: { flexDirection: 'row', gap: 8, paddingBottom: 13 }, wrapChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }, chip: { borderRadius: 30, paddingHorizontal: 14, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.card }, chipActive: { borderColor: C.primary, backgroundColor: C.primary }, chipText: { fontFamily: medium, fontSize: 11, color: C.foreground }, chipTextActive: { color: C.primaryForeground },
  demoTag: { alignSelf: 'flex-start', minHeight: 23, borderRadius: 20, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.lavender, marginVertical: 7 }, demoDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.gold }, demoText: { color: C.primary, fontFamily: semi, fontSize: 9, letterSpacing: 0.7 },
  emptyCard: { backgroundColor: C.card, borderRadius: 20, padding: 19, alignItems: 'flex-start', borderWidth: 1, borderColor: C.border, marginTop: 5 }, emptyIcon: { width: 43, height: 43, borderRadius: 15, backgroundColor: C.lavender, alignItems: 'center', justifyContent: 'center', marginBottom: 13 }, emptyTitle: { fontFamily: display, color: C.foreground, fontSize: 16, marginBottom: 4 }, emptyCopy: { fontFamily: body, color: C.mutedForeground, fontSize: 12, lineHeight: 18, marginBottom: 14 },
  button: { minHeight: 47, borderRadius: 15, paddingHorizontal: 16, backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, buttonText: { fontFamily: semi, fontSize: 13, color: C.primaryForeground }, buttonSecondary: { backgroundColor: C.lavender, borderWidth: 1, borderColor: '#DED2E8' }, buttonSecondaryText: { color: C.primary },
  scanHero: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 22 }, scanGlyph: { width: 74, height: 74, backgroundColor: C.lavender, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }, demoBanner: { flexDirection: 'row', gap: 9, alignItems: 'center', padding: 13, borderRadius: 14, backgroundColor: C.lavender, marginBottom: 22 }, bannerCopy: { flex: 1, color: C.primary, fontFamily: medium, fontSize: 11, lineHeight: 16 },
  inputLabel: { fontFamily: semi, fontSize: 12, color: C.foreground, marginBottom: 8 }, codeInputWrap: { flexDirection: 'row', borderRadius: 16, borderColor: C.border, borderWidth: 1, backgroundColor: C.card, padding: 5, marginBottom: 16 }, codeInput: { flex: 1, paddingHorizontal: 11, fontFamily: body, fontSize: 13, color: C.foreground }, lookupBtn: { backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', minHeight: 43 }, lookupText: { fontFamily: semi, fontSize: 12, color: C.primaryForeground },
  foundCard: { backgroundColor: C.card, borderRadius: 18, borderColor: C.border, borderWidth: 1, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 17 }, foundImage: { width: 62, height: 62, borderRadius: 13 }, codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }, codeProduct: { flex: 1, fontFamily: medium, color: C.foreground, fontSize: 12 }, code: { fontFamily: body, fontSize: 10, color: C.mutedForeground },
  communityPost: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 15, marginTop: 12 }, postHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 13 }, initialAvatar: { width: 38, height: 38, borderRadius: 14, backgroundColor: C.lavender, alignItems: 'center', justifyContent: 'center' }, avatarText: { fontFamily: semi, color: C.primary, fontSize: 12 }, postName: { fontFamily: semi, color: C.foreground, fontSize: 12 }, postMeta: { fontFamily: body, color: C.mutedForeground, fontSize: 10, marginTop: 2 },
  postText: { fontFamily: body, color: C.foreground, fontSize: 14, lineHeight: 21 }, postDisclaimer: { fontFamily: body, color: C.mutedForeground, fontSize: 10, lineHeight: 15, marginTop: 8 }, postProduct: { flexDirection: 'row', gap: 9, alignItems: 'center', backgroundColor: C.background, borderRadius: 14, padding: 8, marginTop: 14 }, postProductImage: { width: 49, height: 49, borderRadius: 11 }, postProductName: { fontFamily: semi, color: C.foreground, fontSize: 11 }, postFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }, row: { flexDirection: 'row', alignItems: 'center', gap: 6 }, askPill: { borderRadius: 20, backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8 }, askPillText: { fontFamily: semi, color: C.primaryForeground, fontSize: 10 },
  profileHero: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 }, profileAvatar: { width: 56, height: 56, borderRadius: 20, backgroundColor: C.lavender, alignItems: 'center', justifyContent: 'center' }, profileInitial: { fontFamily: display, fontSize: 24, color: C.primary }, profileName: { fontFamily: display, color: C.foreground, fontSize: 16 }, statsRow: { flexDirection: 'row', backgroundColor: C.lavender, borderRadius: 18, paddingVertical: 13, marginVertical: 12 }, stat: { flex: 1, alignItems: 'center', borderRightWidth: 1, borderRightColor: '#D8CCDF' }, statValue: { fontFamily: display, fontSize: 19, color: C.primary }, statLabel: { fontFamily: body, fontSize: 10, color: C.mutedForeground },
  preferenceCard: { backgroundColor: C.card, padding: 15, borderRadius: 18, borderWidth: 1, borderColor: C.border }, preferenceLabel: { fontFamily: semi, fontSize: 12, color: C.foreground, marginBottom: 8 }, prefChip: { backgroundColor: C.lavender, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 }, prefChipText: { fontFamily: medium, fontSize: 10, color: C.primary }, editRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7, paddingTop: 7 }, consentCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 14, marginBottom: 12 }, consentCopy: { fontFamily: body, color: C.mutedForeground, fontSize: 11, lineHeight: 17 }, menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border }, menuIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: C.lavender, alignItems: 'center', justifyContent: 'center' }, menuTitle: { fontFamily: semi, color: C.foreground, fontSize: 12 }, menuDetail: { fontFamily: body, color: C.mutedForeground, fontSize: 10, marginTop: 3 },
  onboardingBottom: { marginTop: 28 }, skipBtn: { alignItems: 'center', paddingVertical: 14 }, privacyFoot: { textAlign: 'center', fontFamily: body, color: C.mutedForeground, fontSize: 10, marginTop: 10, lineHeight: 15 }, formInput: { borderWidth: 1, borderColor: C.border, backgroundColor: C.card, borderRadius: 15, paddingHorizontal: 13, paddingVertical: 12, fontFamily: body, color: C.foreground, fontSize: 13, marginBottom: 14 },
  detailImageWrap: { position: 'relative' }, detailImage: { width: '100%', height: 248, borderRadius: 22, backgroundColor: C.muted }, imageDemo: { position: 'absolute', top: 10, left: 10 }, productHeading: { paddingTop: 14, paddingBottom: 8 }, detailTitle: { fontFamily: display, color: C.foreground, fontSize: 26, lineHeight: 33, letterSpacing: -0.7 }, ratingLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9 }, fitCard: { backgroundColor: C.lavender, borderRadius: 18, padding: 15, borderLeftWidth: 3, borderLeftColor: C.gold, marginVertical: 12 }, fitTitle: { fontFamily: semi, color: C.primary, fontSize: 13 }, fitCopy: { fontFamily: body, color: C.foreground, fontSize: 12, lineHeight: 18, marginTop: 8 }, subtleDisclaimer: { fontFamily: body, fontSize: 10, lineHeight: 15, color: C.mutedForeground, marginTop: -6, marginBottom: 10 },
  scoreRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }, scoreTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, scoreName: { fontFamily: medium, fontSize: 12, color: C.foreground }, scoreValue: { fontFamily: display, color: C.primary, fontSize: 17 }, scoreOut: { fontFamily: medium, color: C.mutedForeground, fontSize: 10 }, scoreTrack: { height: 6, backgroundColor: C.lavender, borderRadius: 4, marginTop: 8, overflow: 'hidden' }, scoreFill: { height: 6, borderRadius: 4, backgroundColor: C.primary }, scoreRationale: { fontFamily: body, color: C.foreground, fontSize: 11, lineHeight: 16, marginTop: 7 }, scoreMeta: { fontFamily: body, color: C.mutedForeground, fontSize: 9, lineHeight: 14, marginTop: 4 },
  ingredientCard: { backgroundColor: C.lavender, borderRadius: 17, padding: 14, marginBottom: 10 }, ingredientHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 7 }, ingredientName: { flex: 1, fontFamily: semi, fontSize: 13, color: C.foreground }, evidenceLabel: { fontFamily: semi, fontSize: 9, color: C.primary, backgroundColor: C.card, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20 }, ingredientNote: { fontFamily: body, color: C.mutedForeground, fontSize: 12, lineHeight: 18, marginTop: 9 }, unknownCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 16, padding: 13, marginVertical: 13 }, unknownTitle: { fontFamily: semi, fontSize: 12, color: C.foreground, marginBottom: 4 }, reviewCard: { backgroundColor: C.card, borderRadius: 17, borderWidth: 1, borderColor: C.border, padding: 13 }, actionRow: { flexDirection: 'row', gap: 9, marginTop: 10 }, verified: { fontFamily: body, color: C.mutedForeground, textAlign: 'center', fontSize: 9, marginTop: 12 },
  sourceHeading: { marginTop: 8 }, sourceCaption: { fontFamily: body, fontSize: 10, color: C.mutedForeground, marginTop: -7, marginBottom: 8 }, catalogCard: { alignItems: 'center', paddingHorizontal: 14, minHeight: 92 }, ratingUnavailable: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.lavender, borderRadius: 14, padding: 12, marginVertical: 10 }, sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  askWelcome: { alignItems: 'flex-start', backgroundColor: C.lavender, borderRadius: 21, padding: 17, marginTop: 6, marginBottom: 12 }, askBrandMark: { width: 42, height: 42, borderRadius: 15, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 13 }, askBrandText: { fontFamily: display, color: C.primaryForeground, fontSize: 16 }, contextProduct: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 15, padding: 9, marginBottom: 8 }, contextImage: { width: 48, height: 48, borderRadius: 11 }, suggestion: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48, borderBottomWidth: 1, borderColor: C.border }, suggestionText: { fontFamily: medium, color: C.foreground, fontSize: 12 }, message: { padding: 14, borderRadius: 17, marginVertical: 6 }, userMessage: { backgroundColor: C.primary, marginLeft: 28 }, livMessage: { backgroundColor: C.lavender, marginRight: 16 }, messageRole: { fontFamily: semi, fontSize: 9, letterSpacing: 0.7, color: C.primary, marginBottom: 7 }, messageText: { fontFamily: body, color: C.foreground, fontSize: 13, lineHeight: 20 }, chatComposer: { flexDirection: 'row', alignItems: 'flex-end', padding: 7, gap: 7, backgroundColor: C.card, borderRadius: 17, borderWidth: 1, borderColor: C.border, marginTop: 18 }, chatInput: { flex: 1, maxHeight: 90, minHeight: 39, paddingHorizontal: 9, paddingVertical: 9, fontFamily: body, color: C.foreground, fontSize: 13 },
  segment: { flexDirection: 'row', gap: 5, justifyContent: 'space-between', marginBottom: 5 }, compareProducts: { flexDirection: 'row', gap: 9, marginVertical: 13 }, compareProduct: { flex: 1, position: 'relative', backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 8 }, compareImage: { width: '100%', height: 100, borderRadius: 11, marginBottom: 8 }, removeCompare: { position: 'absolute', right: 12, top: 12, width: 27, height: 27, borderRadius: 12, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }, compareName: { fontFamily: semi, fontSize: 11, color: C.foreground, lineHeight: 15 }, addProduct: { flex: 1, height: 175, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: C.taupe, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', gap: 8 }, addProductText: { fontFamily: medium, fontSize: 10, color: C.mutedForeground, textAlign: 'center' }, addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 9 }, addRowImage: { width: 44, height: 44, borderRadius: 11 }, compareDimension: { marginTop: 12, padding: 13, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16 }, compareDimensionTitle: { fontFamily: semi, fontSize: 12, color: C.foreground, marginBottom: 8 }, compareScore: { flexDirection: 'column', alignItems: 'stretch', gap: 1, marginVertical: 4 },
  listCard: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, marginBottom: 12, padding: 13 }, listHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 }, listIcon: { width: 38, height: 38, backgroundColor: C.lavender, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, listName: { fontFamily: semi, fontSize: 13, color: C.foreground }, listProducts: { paddingTop: 13 }, listProduct: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7 }, listProductImage: { width: 37, height: 37, borderRadius: 9 }, listProductName: { flex: 1, fontFamily: medium, color: C.foreground, fontSize: 11 }, unsave: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 6, paddingBottom: 7 }, modalBackdrop: { flex: 1, backgroundColor: 'rgba(46,43,43,0.38)', justifyContent: 'center', padding: 22 }, modalCard: { backgroundColor: C.background, borderRadius: 22, padding: 18 }, modalTitle: { fontFamily: display, color: C.foreground, fontSize: 19, marginBottom: 15 }, modalActions: { flexDirection: 'row', gap: 9 },
});


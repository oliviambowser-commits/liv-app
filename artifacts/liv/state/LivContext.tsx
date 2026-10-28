import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

export type Score = { value: number; rationale: string; confidence: string; coverage: string; evidenceLabel?: string; sourceMetadata?: string };
export type Product = {
  id: string; brand: string; name: string; category: string; description: string;
  image: any; price: string; ingredients: { name: string; label: string; note: string; sourceMetadata?: string }[];
  scores: Record<string, Score>; rating: number; reviewCount: number; lastVerified: string; code: string;
};
export const DIMENSIONS = ['Ingredients & Safety', 'Effectiveness', 'Transparency', 'Community Experience', 'Value'];
const sampleProducts: Product[] = [
  {
    id: 'daily-cream', brand: 'Liv Sample', name: 'Barrier Cream', category: 'Skincare',
    description: 'An illustrative moisturizer profile for exploring Liv’s breakdown.',
    image: require('../assets/images/demo-moisturizer.jpg'), price: '$18',
    ingredients: [
      { name: 'Ceramides (1, 3, 6-II)', label: 'Strong Evidence', note: 'Skin-identical lipids often used to support the moisture barrier.' },
      { name: 'Hyaluronic Acid', label: 'Well-studied', note: 'A humectant that can help attract water to the skin.' },
      { name: 'Petrolatum', label: 'Established use', note: 'An occlusive ingredient that helps reduce moisture loss.' },
    ],
    scores: {
      'Ingredients & Safety': { value: 92, rationale: 'A familiar, fragrance-free formula profile in this demo dataset.', confidence: 'Moderate', coverage: '3 of 3 highlighted ingredients' },
      Effectiveness: { value: 85, rationale: 'Ingredients commonly used for moisture support; results vary by person.', confidence: 'Moderate', coverage: 'Formula-level estimate' },
      Transparency: { value: 78, rationale: 'Ingredient information is represented; some product context remains unknown.', confidence: 'Limited', coverage: 'Partial demo profile' },
      'Community Experience': { value: 94, rationale: 'Positive pattern in illustrative demo feedback only.', confidence: 'Low', coverage: '12 sample reviews' },
      Value: { value: 90, rationale: 'Illustrative price-to-use estimate for this sample.', confidence: 'Moderate', coverage: 'Sample price $18' },
    }, rating: 4.6, reviewCount: 1204, lastVerified: 'Oct 2026 · demo record', code: 'LIV-DEMO-001',
  },
  {
    id: 'hydration-serum', brand: 'Liv Sample', name: 'Daily Hydration Serum', category: 'Skincare',
    description: 'An illustrative serum profile with a short highlighted ingredient list.',
    image: require('../assets/images/demo-serum.jpg'), price: '$9',
    ingredients: [
      { name: 'Hyaluronic Acid', label: 'Well-studied', note: 'A water-binding ingredient used in many topical formulas.' },
      { name: 'Panthenol (B5)', label: 'Established use', note: 'A conditioning ingredient often included in moisturizing products.' },
    ],
    scores: {
      'Ingredients & Safety': { value: 88, rationale: 'A short highlighted ingredient profile; individual tolerance differs.', confidence: 'Moderate', coverage: '2 highlighted ingredients' },
      Effectiveness: { value: 87, rationale: 'Designed for hydration; outcomes depend on routine and skin.', confidence: 'Moderate', coverage: 'Formula-level estimate' },
      Transparency: { value: 84, rationale: 'A fairly clear sample ingredient profile.', confidence: 'Moderate', coverage: 'Partial demo profile' },
      'Community Experience': { value: 86, rationale: 'Illustrative sample feedback trends positive.', confidence: 'Low', coverage: '8 sample reviews' },
      Value: { value: 94, rationale: 'Lower illustrative sample price per product.', confidence: 'Moderate', coverage: 'Sample price $9' },
    }, rating: 4.5, reviewCount: 860, lastVerified: 'Oct 2026 · demo record', code: 'LIV-DEMO-002',
  },
  {
    id: 'gentle-cleanser', brand: 'Liv Sample', name: 'Gentle Daily Cleanser', category: 'Skincare',
    description: 'An illustrative cleanser profile with incomplete formula details.',
    image: require('../assets/images/demo-cleanser.jpg'), price: '$14',
    ingredients: [
      { name: 'Glycerin', label: 'Well-studied', note: 'A humectant often used to support a comfortable skin feel.' },
      { name: 'Coco-glucoside', label: 'Ingredient note', note: 'A cleansing agent; formula concentration is not available here.' },
    ],
    scores: {
      'Ingredients & Safety': { value: 82, rationale: 'Highlighted profile is brief; completeness is limited.', confidence: 'Limited', coverage: '2 highlighted ingredients' },
      Effectiveness: { value: 79, rationale: 'A cleanser concept; no measured product performance data.', confidence: 'Limited', coverage: 'Concept profile' },
      Transparency: { value: 72, rationale: 'Several formula details are unknown in this sample.', confidence: 'Limited', coverage: 'Sparse demo profile' },
      'Community Experience': { value: 81, rationale: 'Illustrative sample feedback, not verified reviews.', confidence: 'Low', coverage: '5 sample reviews' },
      Value: { value: 86, rationale: 'Illustrative sample price estimate.', confidence: 'Limited', coverage: 'Sample price $14' },
    }, rating: 4.2, reviewCount: 320, lastVerified: 'Oct 2026 · demo record', code: 'LIV-DEMO-003',
  },
];
export const PRODUCTS: Product[] = sampleProducts.map((product) => ({
  ...product,
  ingredients: product.ingredients.map((ingredient) => ({ ...ingredient, sourceMetadata: 'No external source supplied in demo' })),
  scores: Object.fromEntries(Object.entries(product.scores).map(([dimension, score]) => [dimension, {
    ...score, evidenceLabel: 'Illustrative demo estimate', sourceMetadata: 'No external source supplied in demo',
  }])) as Record<string, Score>,
}));
export type Collection = { id: string; name: string; productIds: string[] };
export type Preferences = { interests: string[]; priorities: string[]; restrictions: string[]; note: string; memoryConsent: boolean; onboardingComplete: boolean };
const initialPreferences: Preferences = { interests: ['Skincare'], priorities: ['Ingredients', 'Fragrance-free'], restrictions: [], note: '', memoryConsent: false, onboardingComplete: false };
type StateValue = {
  hydrated: boolean; prefs: Preferences; saved: string[]; recent: string[]; collections: Collection[];
  compare: string[]; toggleSaved: (id: string) => void; visit: (id: string) => void;
  setPrefs: (prefs: Preferences) => void; addCompare: (id: string) => void; removeCompare: (id: string) => void;
  addCollection: (name: string) => void; renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void; toggleCollectionProduct: (collectionId: string, productId: string) => void;
};
const Store = createContext<StateValue | null>(null);
const STORAGE_KEY = 'liv-m0-local-state-v1';
export function LivProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [prefs, setPrefsState] = useState(initialPreferences);
  const [saved, setSaved] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [collections, setCollections] = useState<Collection[]>([
    { id: 'daily', name: 'Skincare routine', productIds: ['daily-cream', 'hydration-serum'] },
    { id: 'home', name: 'Home essentials', productIds: [] },
    { id: 'wish', name: 'Wish list', productIds: [] },
  ]);
  const [compare, setCompare] = useState<string[]>([]);
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        const value = JSON.parse(raw);
        setPrefsState({ ...initialPreferences, ...value.prefs });
        setSaved(value.saved ?? []); setRecent(value.recent ?? []); setCollections(value.collections ?? []);
        setCompare((value.compare ?? []).slice(0, 2));
      }
    }).catch(() => {}).finally(() => setHydrated(true));
  }, []);
  useEffect(() => {
    if (hydrated) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ prefs, saved, recent, collections, compare })).catch(() => {});
  }, [hydrated, prefs, saved, recent, collections, compare]);
  const value = useMemo<StateValue>(() => ({
    hydrated, prefs, saved, recent, collections, compare,
    toggleSaved: (id) => setSaved((items) => items.includes(id) ? items.filter((x) => x !== id) : [id, ...items]),
    visit: (id) => setRecent((items) => [id, ...items.filter((x) => x !== id)].slice(0, 12)),
    setPrefs: setPrefsState,
    addCompare: (id) => setCompare((items) => items.includes(id) ? items : [...items.slice(-1), id]),
    removeCompare: (id) => setCompare((items) => items.filter((x) => x !== id)),
    addCollection: (name) => setCollections((items) => [...items, { id: Date.now().toString(), name: name.trim() || 'New list', productIds: [] }]),
    renameCollection: (id, name) => setCollections((items) => items.map((x) => x.id === id ? { ...x, name } : x)),
    deleteCollection: (id) => setCollections((items) => items.filter((x) => x.id !== id)),
    toggleCollectionProduct: (collectionId, productId) => setCollections((items) => items.map((x) => x.id === collectionId ? { ...x, productIds: x.productIds.includes(productId) ? x.productIds.filter((p) => p !== productId) : [...x.productIds, productId] } : x)),
  }), [hydrated, prefs, saved, recent, collections, compare]);
  return <Store.Provider value={value}>{children}</Store.Provider>;
}
export function useLiv() {
  const value = useContext(Store);
  if (!value) throw new Error('useLiv must be used inside LivProvider');
  return value;
}

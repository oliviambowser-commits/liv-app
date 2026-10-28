import React from 'react';
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { HomeScreen } from '../../components/LivScreens';
import { useLiv } from '../../state/LivContext';

export default function HomeRoute() {
  const router = useRouter();
  const { hydrated, prefs } = useLiv();

  useEffect(() => {
    if (hydrated && !prefs.onboardingComplete) {
      router.replace('/onboarding');
    }
  }, [hydrated, prefs.onboardingComplete, router]);

  if (!hydrated || !prefs.onboardingComplete) return null;
  return <HomeScreen />;
}

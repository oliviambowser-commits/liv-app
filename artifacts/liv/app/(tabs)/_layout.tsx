import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '../../constants/colors';

const C = colors.light;
const tabs: { name: string; title: string; icon: keyof typeof Feather.glyphMap }[] = [
  { name: 'index', title: 'Home', icon: 'home' },
  { name: 'search', title: 'Search', icon: 'search' },
  { name: 'scan', title: 'Scan', icon: 'maximize' },
  { name: 'community', title: 'Community', icon: 'users' },
  { name: 'profile', title: 'Profile', icon: 'user' },
];
export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: C.primary,
    tabBarInactiveTintColor: C.mutedForeground,
    tabBarLabelStyle: { fontSize: 9, fontFamily: 'Inter_500Medium', marginTop: -2 },
    tabBarStyle: {
      position: 'absolute', backgroundColor: Platform.OS === 'ios' ? 'transparent' : C.card,
      borderTopColor: C.border, borderTopWidth: 1, elevation: 0,
      height: 58 + (isWeb ? 26 : insets.bottom), paddingTop: 7, paddingBottom: isWeb ? 26 : Math.max(insets.bottom, 5),
    },
    tabBarBackground: () => Platform.OS === 'ios' ? <BlurView tint="light" intensity={80} style={StyleSheet.absoluteFill}/> : <View style={[StyleSheet.absoluteFill, { backgroundColor: C.card }]}/>,
  }}>
    {tabs.map((tab) => <Tabs.Screen key={tab.name} name={tab.name} options={{
      title: tab.title,
      tabBarIcon: ({ focused }) => <View style={focused ? styles.activeIcon : styles.icon}>
        <Feather name={tab.icon} size={18} color={focused ? C.primary : C.mutedForeground}/>
      </View>,
      tabBarAccessibilityLabel: `${tab.title} tab`,
    }}/>)}
  </Tabs>;
}
const styles = StyleSheet.create({
  icon: { width: 32, height: 28, alignItems: 'center', justifyContent: 'center' },
  activeIcon: { width: 32, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.lavender },
});

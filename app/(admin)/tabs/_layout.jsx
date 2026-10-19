import { Feather, MaterialIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

export default function AdminLayout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="Home"
        options={{
          title: 'Home',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="home" size={size} color={color} />
          ),
        }}
      />
      {/* <Tabs.Screen
        name="monitor"
        options={{
          title: 'Monitor',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="remove-red-eye" size={size} color={color} />
          ),
        }}
      /> */}
      <Tabs.Screen
        name="investigate"
        options={{
          title: 'Investigate',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="person-search" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: 'Insights',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="insights" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
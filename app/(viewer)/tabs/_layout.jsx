import { Feather, MaterialIcons } from '@expo/vector-icons';


import { Tabs } from 'expo-router'; // <-- The Tabs component is what renders the bottom bar

export default function AdminLayout() {
  return (
    <Tabs> {/* This is where the bottom navigation bar originates */}
      <Tabs.Screen
        name="monitor" // This defines the "Upload" tab
        options={{
          title: 'Monitor', // The text "Upload" on the tab
          tabBarIcon: ({ color, size }) => ( // The icon for the "Upload" tab
            <Feather name="camera" size={size} color={color} />
          ),
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="insights" // This defines the "Images" tab
        options={{
          title: 'Insights',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="insights" size={size} color={color} />
          ),
           headerShown: false,
        }}
      />
      <Tabs.Screen
        name="investigate" // This defines the "Profile" tab
        options={{
          title: 'Investigate',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="person-search" size={size} color={color} />
          ),
          headerShown: false,
        }}
      />
      {/* <Tabs.Screen
        name="settings" // This defines the "Settings" tab
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="settings" size={size} color={color} />
          ),
        }}
      /> */}
    </Tabs>
  );
}
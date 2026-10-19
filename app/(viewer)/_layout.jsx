import { Stack } from 'expo-router';

export default function AdminLayout() {
  return (
    <Stack>
      <Stack.Screen name="tabs" options={{ headerShown: false }} />
      <Stack.Screen
        name="invoice-upload"
        options={{
          title: 'Upload Invoice',
          presentation: 'card', // optional: slide-up effect
        }}
      />
    </Stack>
  );
}
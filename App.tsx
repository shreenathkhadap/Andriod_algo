import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import RolesScreen from './src/screens/RolesScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Roles">
        <Stack.Screen name="Roles" component={RolesScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

interface ThemeContextType {
    isDarkMode: boolean;
    toggleTheme: () => void;
    colors: {
        bg: string;
        primary: string;
        primaryLight: string;
        surface: string;
        surfaceVariant: string;
        text: string;
        textSecondary: string;
        border: string;
        tabBar: string;
        tabBarBorder: string;
    };
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const systemColorScheme = useColorScheme();
    const [isDarkMode, setIsDarkMode] = useState(systemColorScheme === 'dark');

    // Load saved theme preference
    useEffect(() => {
        loadThemePreference();
    }, []);

    const loadThemePreference = async () => {
        try {
            const savedTheme = await AsyncStorage.getItem('theme');
            if (savedTheme !== null) {
                setIsDarkMode(savedTheme === 'dark');
            }
        } catch (error) {
            console.error('Failed to load theme preference', error);
        }
    };

    const toggleTheme = async () => {
        const newTheme = !isDarkMode;
        setIsDarkMode(newTheme);
        try {
            await AsyncStorage.setItem('theme', newTheme ? 'dark' : 'light');
        } catch (error) {
            console.error('Failed to save theme preference', error);
        }
    };

    const colors = isDarkMode ? {
        bg: '#0F1F0F',
        primary: '#4CAF50',
        primaryLight: '#66BB6A',
        surface: '#1A2F1A',
        surfaceVariant: '#243824',
        text: '#E8F4E8',
        textSecondary: '#A5C9A5',
        border: '#2D4A2D',
        tabBar: '#1A2F1A',
        tabBarBorder: '#2D4A2D',
    } : {
        bg: '#F5F9F5',
        primary: '#1B4D1B',
        primaryLight: '#2C5F2D',
        surface: '#FFFFFF',
        surfaceVariant: '#E8F4E8',
        text: '#1A1A1A',
        textSecondary: '#5A6A5A',
        border: '#D4E9D4',
        tabBar: '#FFFFFF',
        tabBarBorder: '#D4E9D4',
    };

    return (
        <ThemeContext.Provider value={{ isDarkMode, toggleTheme, colors }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

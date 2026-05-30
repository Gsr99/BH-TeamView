import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/index'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: any }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function buildManagerProfile(user: User): Profile {
  const fullName =
    typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : user.email?.split('@')[0] || 'Manager'

  const now = new Date().toISOString()

  return {
    id: user.id,
    full_name: fullName,
    email: user.email || '',
    role: 'manager',
    is_active: true,
    created_at: now,
    updated_at: now,
  }
}

async function syncManagerProfile(authUser: User, existingProfile?: Profile | null) {
  const managerProfile = buildManagerProfile(authUser)
  const profileData = {
    ...managerProfile,
    created_at: existingProfile?.created_at || managerProfile.created_at,
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert(profileData, { onConflict: 'id' })
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('Profile sync error:', error)
    return existingProfile || managerProfile
  }

  return data || existingProfile || managerProfile
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const currentUserIdRef = useRef<string | null>(null)
  const currentSessionRef = useRef<Session | null>(null)
  const signingOutRef = useRef(false)

  const fetchProfile = async (authUser: User) => {
    try {
      console.log('Fetching profile for:', authUser.id)
      
      const result = await Promise.race([
        supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout after 5s')), 5000)
        )
      ]) as any

      console.log('Result:', result)

      if (result.error) {
        console.error('Profile fetch error:', result.error)
        const metadataRole = authUser.user_metadata?.role
        if (metadataRole === 'manager') {
          const syncedProfile = await syncManagerProfile(authUser)
          setProfile(syncedProfile)
        } else {
          setProfile(prev => prev?.id === authUser.id ? prev : null)
        }
      } else if (!result.data) {
        if (authUser.user_metadata?.role !== 'manager') {
          setProfile(prev => prev?.id === authUser.id ? prev : null)
          return
        }

        const syncedProfile = await syncManagerProfile(authUser)
        console.log('Profile synced:', syncedProfile)
        setProfile(syncedProfile)
      } else {
        if (authUser.user_metadata?.role === 'manager') {
          const needsSync =
            !result.data.full_name ||
            !result.data.email ||
            result.data.role !== 'manager'

          if (needsSync) {
            const syncedProfile = await syncManagerProfile(authUser, result.data)
            console.log('Profile repaired:', syncedProfile)
            setProfile(syncedProfile)
            return
          }
        }

        console.log('Profile loaded:', result.data)
        setProfile(result.data)
      }
    } catch (error) {
      console.error('fetchProfile exception:', error)
      setProfile(prev => prev?.id === authUser.id ? prev : null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('Session:', session?.user?.id)
      currentUserIdRef.current = session?.user?.id ?? null
      currentSessionRef.current = session
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user)
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth event:', event, session?.user?.id)
        const nextUserId = session?.user?.id ?? null

        if (event === 'SIGNED_OUT') {
          if (!signingOutRef.current && currentSessionRef.current) {
            await supabase.auth.setSession({
              access_token: currentSessionRef.current.access_token,
              refresh_token: currentSessionRef.current.refresh_token,
            })
            return
          }

          currentUserIdRef.current = null
          currentSessionRef.current = null
          setUser(null)
          setProfile(null)
          setLoading(false)
          signingOutRef.current = false
          return
        }

        if (
          nextUserId &&
          currentUserIdRef.current &&
          nextUserId !== currentUserIdRef.current &&
          currentSessionRef.current
        ) {
          console.warn('Ignored unexpected auth user switch:', {
            from: currentUserIdRef.current,
            to: nextUserId,
          })
          await supabase.auth.setSession({
            access_token: currentSessionRef.current.access_token,
            refresh_token: currentSessionRef.current.refresh_token,
          })
          return
        }

        currentUserIdRef.current = nextUserId
        currentSessionRef.current = session
        setUser(session?.user ?? null)
        if (session?.user) {
          await fetchProfile(session.user)
        } else {
          setProfile(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    signingOutRef.current = false
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  const signOut = async () => {
    signingOutRef.current = true
    await supabase.auth.signOut()
    currentUserIdRef.current = null
    currentSessionRef.current = null
    setProfile(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}

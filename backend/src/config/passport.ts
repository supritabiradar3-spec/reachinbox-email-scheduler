import passport from 'passport';
import { Strategy as GoogleStrategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { config } from './env.js';
import { prisma } from './prisma.js';

export const configurePassport = (): void => {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.google.clientId || 'placeholder-client-id.apps.googleusercontent.com',
        clientSecret: config.google.clientSecret || 'placeholder-client-secret',
        callbackURL: config.google.callbackUrl,
        scope: ['profile', 'email']
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: VerifyCallback
      ) => {
        try {
          const googleId = profile.id;
          const email = profile.emails?.[0]?.value;
          const name = profile.displayName || `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim() || null;
          const avatarUrl = profile.photos?.[0]?.value || null;

          if (!email) {
            return done(new Error('No email found in Google profile'), undefined);
          }

          const user = await prisma.user.upsert({
            where: { googleId },
            update: {
              email,
              name: name || undefined,
              avatarUrl: avatarUrl || undefined
            },
            create: {
              googleId,
              email,
              name,
              avatarUrl
            }
          });

          return done(null, user);
        } catch (error) {
          return done(error as Error, undefined);
        }
      }
    )
  );

  passport.serializeUser((user: Express.User, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id }
      });
      done(null, user || null);
    } catch (error) {
      done(error, null);
    }
  });
};

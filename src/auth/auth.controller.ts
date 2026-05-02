import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { SocialCompleteDto } from './dto/social-complete.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SupabaseGuard, AuthUser } from './supabase.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('signup')
  signup(@Body() dto: SignupDto) {
    try {
      return this.authService.signup(dto);
    } catch (error) {
      console.error('Error occurred while signing up:', error);
      throw error;
    }
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refresh_token);
  }

  @Post('social/complete')
  @UseGuards(SupabaseGuard)
  socialComplete(@Body() dto: SocialCompleteDto, @Req() req: any) {
    const user = req.user as AuthUser;
    return this.authService.socialComplete(user.supabase_uid, user.email, dto);
  }
}

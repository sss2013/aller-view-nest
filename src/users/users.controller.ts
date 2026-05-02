import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SupabaseGuard, AuthUser } from '../auth/supabase.guard';

@Controller('users')
@UseGuards(SupabaseGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me/profile')
  getProfile(@Req() req: any) {
    const user = req.user as AuthUser;
    return this.usersService.getProfile(user.supabase_uid);
  }

  @Put('me/profile')
  updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    const user = req.user as AuthUser;
    return this.usersService.updateProfile(user.supabase_uid, dto);
  }
}

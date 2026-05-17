import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MenuService } from './menu.service';
import { AnalyzeMenuDto } from './dto/analyze-menu.dto';
import { GetDishDetailsDto } from './dto/get-dish-details.dto';

@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) { }

  @Post('analyze')
  analyze(@Body() dto: AnalyzeMenuDto) {
    return this.menuService.analyze(dto);
  }

  @Get('analyze/:jobId')
  getJobResult(@Param('jobId') jobId: string) {
    return this.menuService.getJobResult(jobId);
  }

  @Post('details')
  getDetails(@Body() dto: GetDishDetailsDto) {
    return this.menuService.getDetails(dto);
  }
}

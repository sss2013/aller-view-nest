import { Body, Controller, Delete, Post } from '@nestjs/common';
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

  @Delete('dishes')
  deleteDishesByNames(@Body('names') names: string[]) {
    return this.menuService.deleteDishesByNames(names);
  }

  @Post('details')
  getDetails(@Body() dto: GetDishDetailsDto) {
    return this.menuService.getDetails(dto);
  }
}

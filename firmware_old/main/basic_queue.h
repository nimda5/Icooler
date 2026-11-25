/*
 *	Basic pointer queue implementation
 *	Functions
 *	tBasicQ_result	push(pBasicQ pQueue,(void *) pointer) - pushes data in queue, True - if ok, False - if failed
 *	tBasicQ_reault	pop(pBasicQ pQueue, &(void *) pointer) - pops out data from 0 position, shift rest positions down
 *	tBasicQ_result	eval(pBasicQ, const char string) - comapres all data avaiable in queue with supplied data
 *	tBasicQ_result	init(pBasiQ) - initializes basic queue
 **/
 //---
 #include "stdio.h"
 #include "string.h"
#ifndef BASICQ_H
#define BASICQ_H
typedef struct
{
	uint8_t	index;
	char * data[10];
	
} tBasicQ;
typedef tBasicQ * pBasicQ;
typedef enum
{
	Failed = 0,
	Bad = 1,
	Good = 2,
	Ok = 3,
	Present = 4
} tBasicQ_result;
//---
tBasicQ_result push_BQ(pBasicQ pQueue, char * pData);
tBasicQ_result pop_BQ(pBasicQ pQueue, char ** pData);
tBasicQ_result	eval_BQ(pBasicQ pQueue, const char * data);
tBasicQ_result	init_BQ(pBasicQ pQueue);
#endif
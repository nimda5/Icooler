/*
 *	Basic pointer queue implementation
 *	Functions
 *	tBasicQ_result	push(pBasicQ pQueue,(void *) pointer) - pushes data in queue, True - if ok, False - if failed
 *	tBasicQ_reault	pop(pBasicQ pQueue, &(void *) pointer) - pops out data from 0 position, shift rest positions down
 *	tBasicQ_result	eval(pBasicQ, const char string) - comapres all data avaiable in queue with supplied data
 *	tBasicQ_result	init(pBasiQ) - initializes basic queue
 **/
 //---
#include "basic_queue.h"
//---
tBasicQ_result push_BQ(pBasicQ pQueue, char * pData)
{
	if (pQueue->index < 10)
	{
		pQueue->data[pQueue->index] = pData;
		pQueue->index++;
		return Ok;
	}
	return Failed;			
}
//---
tBasicQ_result pop_BQ(pBasicQ pQueue, char ** pData)
{
	if (pQueue->data[0] != NULL)
	{
		*pData = pQueue->data[0];
		//next shift all data down
		for (uint8_t i = 1; i <= pQueue->index; i++)
		{
			pQueue->data[i - 1] = pQueue->data[i];
		}
		pQueue->data[pQueue->index] = NULL;
		if (pQueue->index > 0) { pQueue->index--; }
		return Ok;
	}
	return Failed;
}
//---
tBasicQ_result	eval_BQ(pBasicQ pQueue, const char * data)
{
	uint8_t	i = 0;
	while (i < pQueue->index)
	{
		if (strcmp((char *)pQueue->data[i], data) == 0)	{ return Present; }
		i++;
	}
	return Failed;
}
//---
tBasicQ_result	init_BQ(pBasicQ pQueue)
{
	for (uint8_t i = 0; i < 10; i++)
	{
		pQueue->data[i] = NULL;
	}
	pQueue->index = 0;
	
	return Ok;
}